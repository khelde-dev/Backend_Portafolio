import { describe, expect, it } from "bun:test";
import { setFakeDbResult } from "../support/fakeDb.js";
import { adminAuthed, app, authed, TOKEN } from "../support/helpers.js";

const GOOD = "http://localhost:4321";

const preflight = (origin: string, env = {}, method = "POST") =>
	app.request(
		"/api/projects",
		{
			method: "OPTIONS",
			headers: {
				Origin: origin,
				"Access-Control-Request-Method": method,
				"Access-Control-Request-Headers": "authorization,content-type",
			},
		},
		env,
	);

describe("CORS: origenes", () => {
	it("el origen permitido recibe su propio origen y credenciales", async () => {
		const res = await preflight(GOOD);
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe(GOOD);
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");
		expect(res.headers.get("vary")).toContain("Origin");
	});

	const hostile = [
		"https://evil.com",
		"http://localhost:4321.evil.com",
		"http://evil.com/http://localhost:4321",
		"http://localhost:4322", // otro puerto no declarado en el entorno de prueba
		"https://localhost:4321", // esquema distinto
		"HTTP://LOCALHOST:4321", // mayusculas
		"null",
		"",
		"*",
	];
	for (const origin of hostile) {
		it(`no refleja ${JSON.stringify(origin)}`, async () => {
			const res = await preflight(origin);
			// Sin ACAO el navegador descarta la respuesta, aunque la cabecera
			// de credenciales viaje sola.
			expect(res.headers.get("access-control-allow-origin")).toBeNull();
		});
	}

	it("jamas responde `*` (menos aun con credenciales)", async () => {
		for (const origin of [GOOD, "https://evil.com"]) {
			const res = await preflight(origin);
			expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
		}
	});

	it("sin ALLOWED_ORIGINS no se permite ningun origen", async () => {
		const res = await preflight(GOOD, { ALLOWED_ORIGINS: "" });
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("acepta varios origenes separados por coma, con espacios", async () => {
		const env = { ALLOWED_ORIGINS: "https://a.com , https://b.com" };
		expect(
			(await preflight("https://b.com", env)).headers.get(
				"access-control-allow-origin",
			),
		).toBe("https://b.com");
		expect(
			(await preflight("https://c.com", env)).headers.get(
				"access-control-allow-origin",
			),
		).toBeNull();
	});
});

describe("CORS: metodos y cabeceras", () => {
	it("solo anuncia GET, POST, PUT, DELETE y OPTIONS", async () => {
		const res = await preflight(GOOD);
		const methods = (res.headers.get("access-control-allow-methods") ?? "")
			.split(",")
			.map((m) => m.trim())
			.sort();
		expect(methods).toEqual(["DELETE", "GET", "OPTIONS", "POST", "PUT"]);
	});

	it("solo anuncia Authorization y Content-Type", async () => {
		const res = await preflight(GOOD);
		const headers = (res.headers.get("access-control-allow-headers") ?? "")
			.split(",")
			.map((h) => h.trim().toLowerCase())
			.sort();
		expect(headers).toEqual(["authorization", "content-type"]);
	});

	it("el preflight no necesita (ni revela) nada autenticado", async () => {
		const res = await preflight(GOOD);
		expect(res.status).toBe(204);
		expect(await res.text()).toBe("");
	});
});

describe("CSRF", () => {
	const formTypes = [
		"application/x-www-form-urlencoded",
		"multipart/form-data; boundary=x",
		"text/plain",
	];

	for (const contentType of formTypes) {
		it(`bloquea POST de un origen ajeno con ${contentType}`, async () => {
			const res = await app.request("/api/comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					Origin: "https://evil.com",
					"Content-Type": contentType,
				},
				body: "a=b",
			});
			expect(res.status).toBe(403);
		});
	}

	it("bloquea un formulario sin Content-Type y con origen ajeno", async () => {
		const res = await app.request("/api/comments", {
			method: "POST",
			headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.com" },
			body: "a=b",
		});
		expect(res.status).toBe(403);
	});

	it("bloquea tambien las escrituras del CMS desde un origen ajeno", async () => {
		const init = await adminAuthed({ method: "DELETE" });
		const res = await app.request("/api/projects/1", {
			...init,
			headers: {
				...(init.headers as Record<string, string>),
				Origin: "https://evil.com",
				"Content-Type": "text/plain",
			},
		});
		expect(res.status).toBe(403);
	});

	it("deja pasar el formulario desde un origen permitido", async () => {
		setFakeDbResult([{ project_id: 1 }]);
		const res = await app.request("/api/contact-messages", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				Origin: GOOD,
				"Content-Type": "text/plain",
				"x-forwarded-for": "198.51.100.10",
			},
			body: "{}",
		});
		expect(res.status).not.toBe(403);
	});

	it("el cliente servidor-a-servidor (sin Origin, JSON) sigue funcionando", async () => {
		const res = await app.request("/api/comments", authed());
		expect(res.status).not.toBe(403);
	});
});
