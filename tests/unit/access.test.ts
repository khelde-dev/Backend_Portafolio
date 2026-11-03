import { afterEach, describe, expect, it } from "bun:test";
import { resetFakeDbCalls, setFakeDbResult } from "../support/fakeDb.js";
import { accessJwt, app, authed } from "../support/helpers.js";

const ADMIN_LIST = "/api/projects/admin";

const withAccess = (token: string): RequestInit => ({
	...authed(),
	headers: {
		...(authed().headers as Record<string, string>),
		"Cf-Access-Jwt-Assertion": token,
	},
});

describe("Cloudflare Access (rutas del CMS)", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("401 sin la cabecera de Access, aunque traiga el bearer token", async () => {
		const res = await app.request(ADMIN_LIST, authed());
		expect(res.status).toBe(401);
	});

	it("401 sin bearer token, aunque traiga una sesion de Access valida", async () => {
		const res = await app.request(ADMIN_LIST, {
			headers: { "Cf-Access-Jwt-Assertion": await accessJwt() },
		});
		expect(res.status).toBe(401);
	});

	it("200 con bearer token y una sesion de Access valida", async () => {
		const res = await app.request(ADMIN_LIST, withAccess(await accessJwt()));
		expect(res.status).toBe(200);
		expect((await res.json()).success).toBe(true);
	});

	it("401 si el JWT es basura", async () => {
		const res = await app.request(ADMIN_LIST, withAccess("no-es-un-jwt"));
		expect(res.status).toBe(401);
	});

	it("401 si el JWT esta firmado con otra llave", async () => {
		const other = await crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["sign", "verify"],
		);
		const token = await accessJwt({}, other.privateKey);
		const res = await app.request(ADMIN_LIST, withAccess(token));
		expect(res.status).toBe(401);
	});

	it("401 si la audiencia (AUD) no es la de esta aplicacion", async () => {
		const token = await accessJwt({ aud: ["otra-app"] });
		const res = await app.request(ADMIN_LIST, withAccess(token));
		expect(res.status).toBe(401);
	});

	it("401 si el emisor no es el team domain configurado", async () => {
		const token = await accessJwt({ iss: "https://otro.cloudflareaccess.com" });
		const res = await app.request(ADMIN_LIST, withAccess(token));
		expect(res.status).toBe(401);
	});

	it("401 si el JWT ya expiro", async () => {
		const token = await accessJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
		const res = await app.request(ADMIN_LIST, withAccess(token));
		expect(res.status).toBe(401);
	});

	it("503 si Access no esta configurado (no deja pasar a nadie)", async () => {
		const res = await app.request(ADMIN_LIST, withAccess(await accessJwt()), {
			ACCESS_AUD: "",
		});
		expect(res.status).toBe(503);
	});

	it.each([
		["POST", "/api/projects"],
		["PUT", "/api/projects/1"],
		["PUT", "/api/projects/order"],
		["PUT", "/api/skills/order"],
		["DELETE", "/api/projects/1"],
		["POST", "/api/experiences"],
		["PUT", "/api/education/1"],
		["DELETE", "/api/skills/1"],
		["PUT", "/api/about"],
		["PUT", "/api/comments/1"],
		["PUT", "/api/contact-messages/1"],
		["GET", "/api/contact-messages"],
		["GET", "/api/contact-messages/unread-count"],
		["DELETE", "/api/contact-messages/1"],
		["GET", "/api/comments/admin"],
		["GET", "/api/media"],
		["POST", "/api/media?use=projects"],
		["DELETE", "/api/media/a.webp"],
		["GET", "/api/comments/pending-count"],
		["DELETE", "/api/comments/1"],
	])("%s %s exige Access", async (method, path) => {
		const res = await app.request(
			path,
			authed({
				method,
				body: method === "GET" || method === "DELETE" ? undefined : "{}",
			}),
		);
		expect(res.status).toBe(401);
	});

	it("las lecturas publicas NO piden Access", async () => {
		for (const path of [
			"/api/projects?currentLocale=es",
			"/api/experiences?currentLocale=es",
			"/api/education?currentLocale=es",
			"/api/skills?currentLocale=es",
			"/api/about?currentLocale=es",
			"/api/comments",
		]) {
			const res = await app.request(path, authed());
			expect(res.status).toBe(200);
		}
	});
});

describe("CORS y CSRF por origen configurado", () => {
	it("responde el preflight solo a los origenes de ALLOWED_ORIGINS", async () => {
		const ok = await app.request("/api/projects", {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:4321",
				"Access-Control-Request-Method": "PUT",
			},
		});
		expect(ok.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:4321",
		);
		expect(ok.headers.get("access-control-allow-methods")).toContain("PUT");

		const bad = await app.request("/api/projects", {
			method: "OPTIONS",
			headers: {
				Origin: "https://malo.example",
				"Access-Control-Request-Method": "PUT",
			},
		});
		expect(bad.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("403 en una escritura desde el navegador de un origen no permitido", async () => {
		const res = await app.request(
			"/api/comments",
			authed({
				method: "POST",
				headers: {
					Origin: "https://malo.example",
					"Content-Type": "text/plain",
				},
				body: "{}",
			}),
		);
		expect(res.status).toBe(403);
	});
});
