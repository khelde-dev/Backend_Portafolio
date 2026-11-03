import { describe, expect, it } from "bun:test";
import { accessJwt, app, TOKEN } from "../support/helpers.js";

/**
 * Token exclusivo del CMS (`API_TOKEN_ADMIN`, opcional). Con el configurado, el
 * token del sitio publico sigue sirviendo para las lecturas publicas, pero las
 * rutas del CMS (que ademas piden la sesion de Access) exigen el del CMS.
 */
const ADMIN_TOKEN = "token-exclusivo-del-cms";

const call = async (
	path: string,
	{
		token = TOKEN,
		method = "GET",
		jwt = true,
		env = {},
	}: {
		token?: string | null;
		method?: string;
		jwt?: boolean;
		env?: Record<string, string>;
	} = {},
) =>
	app.request(
		path,
		{
			method,
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...(jwt ? { "Cf-Access-Jwt-Assertion": await accessJwt() } : {}),
			},
			body: method === "GET" || method === "DELETE" ? undefined : "{}",
		},
		env,
	);

const WITH_ADMIN_TOKEN = { API_TOKEN_ADMIN: ADMIN_TOKEN };

// Una muestra de rutas del CMS de cada router.
const CMS_ROUTES: [string, string][] = [
	["GET", "/api/audit"],
	["PUT", "/api/site-copy"],
	["GET", "/api/projects/admin"],
	["PUT", "/api/projects/1"],
	["DELETE", "/api/projects/1"],
	["GET", "/api/about/admin"],
	["PUT", "/api/contact-info"],
	["GET", "/api/comments/admin"],
	["GET", "/api/contact-messages"],
	["GET", "/api/media"],
];

describe("sin API_TOKEN_ADMIN (como hasta ahora)", () => {
	it("el token del sitio sigue abriendo las rutas del CMS (con sesion de Access)", async () => {
		const res = await call("/api/audit");
		expect(res.status).toBe(200);
	});
});

describe("con API_TOKEN_ADMIN", () => {
	it.each(CMS_ROUTES)(
		"%s %s: el token del sitio publico ya no sirve",
		async (method, path) => {
			const res = await call(path, { method, env: WITH_ADMIN_TOKEN });
			expect(res.status).toBe(401);
			expect((await res.json()).message).toBe("El token no sirve para el CMS");
		},
	);

	it("el token del CMS abre las rutas del CMS (con sesion de Access)", async () => {
		const res = await call("/api/audit", {
			token: ADMIN_TOKEN,
			env: WITH_ADMIN_TOKEN,
		});
		expect(res.status).toBe(200);
	});

	it("el token del CMS solo no basta: sigue pidiendo la sesion de Access", async () => {
		const res = await call("/api/audit", {
			token: ADMIN_TOKEN,
			jwt: false,
			env: WITH_ADMIN_TOKEN,
		});
		expect(res.status).toBe(401);
		expect((await res.json()).message).toBe(
			"Falta la sesion de Cloudflare Access",
		);
	});

	it("un token distinto de ambos se rechaza en todas partes", async () => {
		for (const path of ["/api/audit", "/api/projects?currentLocale=es"]) {
			const res = await call(path, { token: "otro", env: WITH_ADMIN_TOKEN });
			expect(res.status).toBe(401);
		}
		const none = await call("/api/audit", {
			token: null,
			env: WITH_ADMIN_TOKEN,
		});
		expect(none.status).toBe(401);
	});

	it("las lecturas publicas siguen aceptando el token del sitio (y el del CMS)", async () => {
		for (const token of [TOKEN, ADMIN_TOKEN]) {
			const res = await call("/api/projects?currentLocale=es", {
				token,
				jwt: false,
				env: WITH_ADMIN_TOKEN,
			});
			expect(res.status).toBe(200);
		}
	});

	it("un token que solo se parece (mismo largo) no pasa", async () => {
		const almost = `${ADMIN_TOKEN.slice(0, -1)}X`;
		const res = await call("/api/audit", {
			token: almost,
			env: WITH_ADMIN_TOKEN,
		});
		expect(res.status).toBe(401);
	});
});
