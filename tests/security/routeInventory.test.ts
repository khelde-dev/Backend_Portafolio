import { beforeEach, describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { setFakeDbResult } from "../support/fakeDb.js";
import { accessJwt, app, authed } from "../support/helpers.js";

/**
 * Inventario de rutas + matriz de autorizacion.
 *
 * La lista de abajo es la POLITICA: que rutas existen y quien puede llamarlas.
 * Si alguien agrega una ruta y no la declara aqui, el primer test falla; si
 * declara una ruta como publica y en realidad no exige bearer, o como CMS y no
 * exige Access, fallan los demas. Una ruta nueva no puede nacer abierta sin
 * que una persona lo decida a proposito.
 */
type Policy = "health" | "bearer" | "access";

const POLICY: Record<string, Policy> = {
	"GET /api": "health",

	// Lectura publica del sitio y formularios publicos (con rate limit).
	"GET /api/projects": "bearer",
	"GET /api/experiences": "bearer",
	"GET /api/education": "bearer",
	"GET /api/skills": "bearer",
	"GET /api/about": "bearer",
	"GET /api/comments": "bearer",
	"POST /api/comments": "bearer",
	"POST /api/contact-messages": "bearer",

	// Todo lo demas es del CMS: bearer + sesion de Cloudflare Access.
	"GET /api/projects/admin": "access",
	"POST /api/projects": "access",
	"PUT /api/projects/order": "access",
	"PUT /api/projects/:id": "access",
	"DELETE /api/projects/:id": "access",

	"GET /api/experiences/admin": "access",
	"POST /api/experiences": "access",
	"PUT /api/experiences/order": "access",
	"PUT /api/experiences/:id": "access",
	"DELETE /api/experiences/:id": "access",

	"GET /api/education/admin": "access",
	"POST /api/education": "access",
	"PUT /api/education/order": "access",
	"PUT /api/education/:id": "access",
	"DELETE /api/education/:id": "access",

	"GET /api/skills/admin": "access",
	"POST /api/skills": "access",
	"PUT /api/skills/order": "access",
	"PUT /api/skills/:id": "access",
	"DELETE /api/skills/:id": "access",

	"GET /api/about/admin": "access",
	"PUT /api/about": "access",

	"GET /api/comments/admin": "access",
	"PUT /api/comments/:id": "access",
	"DELETE /api/comments/:id": "access",
	"GET /api/comments/pending-count": "access",

	"GET /api/contact-messages": "access",
	"GET /api/contact-messages/unread-count": "access",
	"PUT /api/contact-messages/:id": "access",
	"DELETE /api/contact-messages/:id": "access",
};

const PUBLIC_FORMS = new Set([
	"POST /api/comments",
	"POST /api/contact-messages",
]);

const discovered = (): string[] =>
	[
		...new Set(
			realApp.routes
				.filter((r) => r.method !== "ALL")
				.map((r) => `${r.method} ${r.path}`),
		),
	].sort();

const entries = Object.entries(POLICY).map(([key, policy]) => {
	const [method, path] = key.split(" ");
	return { key, method, path, policy };
});

const concrete = (path: string) => path.replace(":id", "1");
const bodyFor = (method: string) =>
	method === "POST" || method === "PUT" ? "{}" : undefined;

beforeEach(() => setFakeDbResult([]));

describe("inventario de rutas", () => {
	it("las rutas declaradas son exactamente las que expone la app", () => {
		expect(discovered()).toEqual(Object.keys(POLICY).sort());
	});

	it("solo se usan GET, POST, PUT y DELETE", () => {
		const methods = new Set(entries.map((e) => e.method));
		expect([...methods].sort()).toEqual(["DELETE", "GET", "POST", "PUT"]);
	});

	it("toda ruta que escribe o administra exige Cloudflare Access", () => {
		const sensitive = entries.filter(
			(e) =>
				(e.method !== "GET" || e.path.endsWith("/admin")) &&
				!PUBLIC_FORMS.has(e.key),
		);
		expect(sensitive.length).toBeGreaterThan(0);
		for (const e of sensitive) expect(e.policy).toBe("access");
	});

	it("solo los dos formularios publicos escriben sin Access", () => {
		const open = entries
			.filter((e) => e.method !== "GET" && e.policy !== "access")
			.map((e) => e.key)
			.sort();
		expect(open).toEqual([...PUBLIC_FORMS].sort());
	});
});

describe("matriz de autenticacion", () => {
	for (const { key, method, path, policy } of entries) {
		const url = concrete(path);
		const body = bodyFor(method);

		if (policy === "health") {
			it(`${key} es publica`, async () => {
				expect((await app.request(url)).status).toBe(200);
			});
			continue;
		}

		describe(key, () => {
			it("sin token -> 401", async () => {
				const res = await app.request(url, {
					method,
					body,
					headers: { "Content-Type": "application/json" },
				});
				expect(res.status).toBe(401);
			});

			it("con token falso -> 401", async () => {
				const res = await app.request(url, {
					method,
					body,
					headers: {
						Authorization: "Bearer nope",
						"Content-Type": "application/json",
					},
				});
				expect(res.status).toBe(401);
			});

			if (policy === "bearer") {
				it("con el bearer correcto pasa la autenticacion", async () => {
					const res = await app.request(
						`${url}${method === "GET" ? "?currentLocale=es" : ""}`,
						authed({
							method,
							body,
							headers: { "x-forwarded-for": "198.51.100.77" },
						}),
					);
					expect([401, 403, 503]).not.toContain(res.status);
				});
			}

			if (policy === "access") {
				it("con bearer pero SIN sesion de Access -> 401", async () => {
					const res = await app.request(url, authed({ method, body }));
					expect(res.status).toBe(401);
				});

				it("la autenticacion va antes que la validacion", async () => {
					const res = await app.request(
						url,
						authed({ method, body: method === "GET" ? undefined : "no-json" }),
					);
					expect(res.status).toBe(401);
				});

				it("con bearer y Access validos pasa la autenticacion", async () => {
					const res = await app.request(url, {
						method,
						body,
						headers: {
							Authorization: "Bearer test-api-token",
							"Content-Type": "application/json",
							"Cf-Access-Jwt-Assertion": await accessJwt(),
						},
					});
					expect([401, 403, 503]).not.toContain(res.status);
				});
			}
		});
	}
});

describe("enumeracion de rutas", () => {
	it("una ruta inexistente SIN token responde 401, igual que una real", async () => {
		const ghost = await app.request("/api/secret-admin-panel");
		const real = await app.request("/api/projects");
		expect(ghost.status).toBe(401);
		expect(real.status).toBe(401);
	});

	it("con token, una ruta inexistente es 404 en JSON", async () => {
		const res = await app.request("/api/nada", authed());
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(await res.json()).toEqual({ success: false, message: "Not Found" });
	});

	it("no existen rutas viejas de login ni de usuarios", async () => {
		for (const path of [
			"/api/auth/login",
			"/api/auth/register",
			"/api/users",
		]) {
			const res = await app.request(
				path,
				authed({ method: "POST", body: "{}" }),
			);
			expect(res.status).toBe(404);
		}
	});

	it("los metodos no declarados no se atienden", async () => {
		for (const method of ["PATCH", "TRACE", "PROPFIND"]) {
			const res = await app.request("/api/projects/1", authed({ method }));
			expect([404, 405]).toContain(res.status);
		}
	});
});
