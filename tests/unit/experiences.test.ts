import { afterEach, describe, expect, it } from "bun:test";
import { setFakeDbResult } from "../support/fakeDb.js";
import { adminAuthed, app, authed } from "../support/helpers.js";

describe("GET /api/experiences", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("400 sin currentLocale", async () => {
		const res = await app.request("/api/experiences", authed());
		expect(res.status).toBe(400);
	});

	it("200 con currentLocale presente pero no soportado - cae al fallback (es), no 400", async () => {
		// Cambio de comportamiento intencional (hono/language, ver
		// docs/05-hono-language-and-best-practices.md): un valor PRESENTE
		// pero no reconocido ya no se rechaza - se normaliza al idioma mas
		// cercano o cae al fallback. El 400 se reserva para cuando el
		// parametro esta AUSENTE del todo (ver el test de arriba) - ese es
		// el bug real que ya paso una vez (el proxy de Astro olvido
		// reenviarlo).
		setFakeDbResult([]);
		const res = await app.request(
			"/api/experiences?currentLocale=xx",
			authed(),
		);
		expect(res.status).toBe(200);
	});

	it("200 con currentLocale valido", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/experiences?currentLocale=es",
			authed(),
		);
		expect(res.status).toBe(200);
	});
});

describe("POST /api/experiences", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/experiences",
			authed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(401);
	});

	it("400 con body invalido", async () => {
		const res = await app.request(
			"/api/experiences",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("201 con body valido, translations se manda a la insert de traducciones", async () => {
		setFakeDbResult([{ experience_id: 1 }]);
		const res = await app.request(
			"/api/experiences",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title_default: "Dev",
					subtitle_default: "Empresa",
					img: "test.webp",
					alt: "test",
					time_default: "2026",
					location_default: "Remoto",
					translations: [
						{
							locale: "es",
							title: "Desarrollador",
							subtitle: "Empresa",
							time: "2026",
							location: "Remoto",
						},
					],
				}),
			}),
		);
		expect(res.status).toBe(201);
	});
});

describe("PUT /api/experiences/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("404 si la experiencia no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/experiences/999",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title_default: "x",
					subtitle_default: "x",
					img: "x.webp",
					alt: "x",
					time_default: "x",
					location_default: "x",
					translations: [],
				}),
			}),
		);
		expect(res.status).toBe(404);
	});
});

describe("DELETE /api/experiences/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/experiences/1",
			authed({ method: "DELETE" }),
		);
		expect(res.status).toBe(401);
	});

	it("200 si la experiencia existe", async () => {
		setFakeDbResult([{ experience_id: 1 }]);
		const res = await app.request(
			"/api/experiences/1",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(200);
	});

	it("404 si la experiencia no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/experiences/999",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(404);
	});
});
