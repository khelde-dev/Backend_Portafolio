import { afterEach, describe, expect, it } from "bun:test";
import { adminAuthed, app, authed } from "./helpers.js";
import {
	getInsertCalls,
	resetFakeDbCalls,
	setFakeDbResult,
} from "./mocks/fakeDb.js";

describe("GET /api/projects", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("400 sin currentLocale", async () => {
		const res = await app.request("/api/projects", authed());
		expect(res.status).toBe(400);
	});

	it("200 con currentLocale presente pero no soportado - cae al fallback, no 400", async () => {
		setFakeDbResult([]);
		const res = await app.request("/api/projects?currentLocale=xx", authed());
		expect(res.status).toBe(200);
	});

	it("200 con currentLocale valido", async () => {
		setFakeDbResult([]);
		const res = await app.request("/api/projects?currentLocale=en", authed());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.rows).toEqual([]);
	});
});

describe("POST /api/projects", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/projects",
			authed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(401);
	});

	it("400 con body invalido (falta slug/category/etc)", async () => {
		const res = await app.request(
			"/api/projects",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("201 con body valido, images_topics se manda como JSON string a .values()", async () => {
		setFakeDbResult([{ value: 4 }]); // nextProjectId() lee esto (maxId)
		const res = await app.request(
			"/api/projects",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					slug: "test-project",
					category: "frontend",
					card_image: "test.webp",
					images_topics: ["react", "typescript"],
					title_default: "Test",
					summary_default: "Resumen",
					description_default: "Test description",
					fork: false,
					translations: [
						{
							locale: "es",
							title: "Prueba",
							description: "Descripcion de prueba",
						},
					],
				}),
			}),
		);
		expect(res.status).toBe(201);
		// Una sola escritura: las traducciones viajan en la misma fila.
		const inserts = getInsertCalls() as {
			images_topics: string;
			gallery: string;
			translations: string;
		}[];
		expect(inserts).toHaveLength(1);
		expect(inserts[0].images_topics).toBe(
			JSON.stringify(["react", "typescript"]),
		);
		expect(inserts[0].gallery).toBe("[]");
		expect(JSON.parse(inserts[0].translations)).toEqual({
			es: { title: "Prueba", description: "Descripcion de prueba" },
		});
	});

	it("400 con un slug que no es kebab-case", async () => {
		const res = await app.request(
			"/api/projects",
			await adminAuthed({
				method: "POST",
				body: JSON.stringify({
					slug: "Mi Proyecto",
					category: "frontend",
					card_image: "a.webp",
					title_default: "x",
					summary_default: "x",
					description_default: "x",
				}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("400 con el mismo idioma repetido en las traducciones", async () => {
		const res = await app.request(
			"/api/projects",
			await adminAuthed({
				method: "POST",
				body: JSON.stringify({
					slug: "ok",
					category: "frontend",
					card_image: "a.webp",
					title_default: "x",
					summary_default: "x",
					description_default: "x",
					translations: [
						{ locale: "en", title: "a" },
						{ locale: "en", title: "b" },
					],
				}),
			}),
		);
		expect(res.status).toBe(400);
	});
});

describe("PUT /api/projects/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("404 si el proyecto no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/projects/999",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					slug: "x",
					category: "frontend",
					card_image: "x.webp",
					images_topics: [],
					title_default: "x",
					summary_default: "x",
					description_default: "x",
					fork: false,
					translations: [],
				}),
			}),
		);
		expect(res.status).toBe(404);
	});

	it("400 con un id no numerico", async () => {
		const res = await app.request(
			"/api/projects/no-es-numero",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					slug: "x",
					category: "frontend",
					card_image: "x.webp",
					images_topics: [],
					title_default: "x",
					summary_default: "x",
					description_default: "x",
					fork: false,
					translations: [],
				}),
			}),
		);
		expect(res.status).toBe(400);
	});
});

describe("DELETE /api/projects/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/projects/1",
			authed({ method: "DELETE" }),
		);
		expect(res.status).toBe(401);
	});

	it("404 si el proyecto no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/projects/999",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(404);
	});

	it("200 si el proyecto existe", async () => {
		setFakeDbResult([{ project_id: 1 }]);
		const res = await app.request(
			"/api/projects/1",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(200);
	});
});
