import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { setFakeDbError, setFakeDbResult } from "../support/fakeDb.js";
import { adminAuthed, app, authed } from "../support/helpers.js";

beforeEach(() => setFakeDbResult([]));
afterEach(() => setFakeDbError(null));

describe("cabeceras de seguridad", () => {
	const samples: [
		string,
		() => Promise<Response | Awaited<ReturnType<typeof app.request>>>,
	][] = [
		["publica (health)", () => app.request("/api")],
		["lectura autenticada", () => app.request("/api/comments", authed())],
		["error 401", () => app.request("/api/comments")],
		["error 404", () => app.request("/api/nada", authed())],
	];

	for (const [name, send] of samples) {
		describe(name, () => {
			it("nosniff, sin referrer y sin iframes", async () => {
				const res = await send();
				expect(res.headers.get("x-content-type-options")).toBe("nosniff");
				expect(res.headers.get("referrer-policy")).toBe("no-referrer");
				expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
				expect(res.headers.get("cross-origin-resource-policy")).toBe(
					"same-origin",
				);
			});

			it("CSP minima: no carga nada, no se enmarca y no cambia el <base>", async () => {
				const res = await send();
				const csp = res.headers.get("content-security-policy") ?? "";
				const directives = csp.split(";").map((part) => part.trim());
				expect(directives).toContain("default-src 'none'");
				expect(directives).toContain("frame-ancestors 'none'");
				expect(directives).toContain("base-uri 'none'");
				expect(directives).toContain("form-action 'none'");
				// Ninguna directiva abre la puerta a scripts ni a estilos.
				expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|script-src/);
			});

			it("HSTS con al menos 6 meses", async () => {
				const res = await send();
				const hsts = res.headers.get("strict-transport-security") ?? "";
				const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
				expect(maxAge).toBeGreaterThanOrEqual(15_552_000);
			});

			it("no revela el servidor ni el framework", async () => {
				const res = await send();
				expect(res.headers.get("x-powered-by")).toBeNull();
				expect(res.headers.get("server")).toBeNull();
			});

			it("trae un identificador de peticion para rastrear el log", async () => {
				const res = await send();
				expect(res.headers.get("x-request-id")).toBeTruthy();
			});
		});
	}
});

describe("tipo de contenido", () => {
	it("las respuestas de la API son JSON, nunca HTML", async () => {
		for (const send of [
			() => app.request("/api"),
			() => app.request("/api/comments", authed()),
			() => app.request("/api/comments"),
			() => app.request("/api/nada", authed()),
			() => app.request("/api/projects/x", authed({ method: "DELETE" })),
		]) {
			const res = await send();
			expect(res.headers.get("content-type")).toContain("application/json");
		}
	});

	it("un texto con HTML se devuelve como dato, con nosniff", async () => {
		setFakeDbResult([
			{
				name: "<img src=x onerror=alert(1)>",
				job: null,
				description: "<script>alert(1)</script>",
				country: "MX",
				country_flag: "x",
				direction: "d",
				created_at: "2025-01-01 00:00:00",
				updated_at: "2025-01-01 00:00:00",
			},
		]);
		const res = await app.request("/api/comments", authed());
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});
});

describe("formato uniforme de errores", () => {
	it("401 sin bearer", async () => {
		const res = await app.request("/api/comments");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			success: false,
			message: "No Authorization header",
		});
	});

	it("401 conserva el desafio WWW-Authenticate del bearer", async () => {
		const res = await app.request("/api/comments", {
			headers: { Authorization: "Bearer mal" },
		});
		expect(res.headers.get("www-authenticate")).toContain("Bearer");
	});

	it("400 de validacion no expone nada de la base", async () => {
		const res = await app.request(
			"/api/projects/abc",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
	});

	it("413 si el cuerpo pasa de 50 KB", async () => {
		const res = await app.request(
			"/api/comments",
			authed({
				method: "POST",
				body: JSON.stringify({ description: "x".repeat(60 * 1024) }),
			}),
		);
		expect(res.status).toBe(413);
		expect((await res.json()).success).toBe(false);
	});
});

describe("errores internos no filtran detalles", () => {
	const SECRET =
		"SQLITE_ERROR: no such table: secret_internal /var/app/db.sqlite";

	it("500 generico, sin el mensaje ni la traza del error", async () => {
		setFakeDbError(new Error(SECRET));
		const res = await app.request("/api/comments", authed());
		expect(res.status).toBe(500);
		const text = await res.text();
		expect(JSON.parse(text)).toEqual({
			success: false,
			message: "Internal Server Error",
		});
		expect(text).not.toContain("SQLITE");
		expect(text).not.toContain("secret_internal");
		expect(text).not.toContain("/var/app");
		expect(text).not.toMatch(/\bat \S+ \(/);
	});

	it("el error si queda en el log del servidor, con el id de peticion", async () => {
		const original = console.error;
		const lines: string[] = [];
		console.error = (...args: unknown[]) => {
			lines.push(args.join(" "));
		};
		try {
			setFakeDbError(new Error(SECRET));
			const res = await app.request("/api/comments", authed());
			const id = res.headers.get("x-request-id");
			expect(
				lines.some((l) => l.includes(SECRET) && l.includes(id ?? "?")),
			).toBe(true);
		} finally {
			console.error = original;
		}
	});

	it("un fallo interno en una ruta del CMS tambien es generico", async () => {
		setFakeDbError(new Error(SECRET));
		const res = await app.request("/api/projects/admin", await adminAuthed());
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain("SQLITE");
	});
});

describe("datos danados en la base", () => {
	it("una fecha invalida en un comentario no tumba la lista", async () => {
		setFakeDbResult([
			{
				name: "Ana",
				description: "x",
				direction: "left",
				country: "MX",
				country_flag: "mx",
				created_at: "no-es-fecha",
				updated_at: "no-es-fecha",
			},
		]);
		const res = await app.request("/api/comments", authed());
		expect(res.status).toBe(200);
	});
});
