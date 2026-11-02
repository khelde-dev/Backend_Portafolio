import { afterEach, describe, expect, it } from "bun:test";
import { adminAuthed, app, authed } from "./helpers.js";
import { resetFakeDbCalls, setFakeDbResult } from "./mocks/fakeDb.js";

const VALID_BODY = {
	institution_default: "Universidad de Prueba",
	subtitle_default: "Ingenieria",
	description_default: "Descripcion",
	image: "/test.webp",
	period_default: "2020 - 2024",
	translations: [
		{
			locale: "es",
			subtitle: "Ingenieria",
			description: "Descripcion es",
			period: "2020 - 2024",
		},
	],
};

describe("GET /api/education", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("400 sin currentLocale", async () => {
		const res = await app.request("/api/education", authed());
		expect(res.status).toBe(400);
	});

	it("200 con currentLocale presente pero no soportado - cae al fallback, no 400", async () => {
		setFakeDbResult([]);
		const res = await app.request("/api/education?currentLocale=xx", authed());
		expect(res.status).toBe(200);
	});

	it("200 con currentLocale valido", async () => {
		setFakeDbResult([]);
		const res = await app.request("/api/education?currentLocale=en", authed());
		expect(res.status).toBe(200);
	});
});

describe("POST /api/education", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/education",
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
			"/api/education",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("201 con body valido", async () => {
		setFakeDbResult([{ education_id: 1 }]);
		const res = await app.request(
			"/api/education",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(VALID_BODY),
			}),
		);
		expect(res.status).toBe(201);
	});
});

describe("PUT /api/education/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("404 si la institucion no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/education/999",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(VALID_BODY),
			}),
		);
		expect(res.status).toBe(404);
	});
});

describe("DELETE /api/education/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/education/1",
			authed({ method: "DELETE" }),
		);
		expect(res.status).toBe(401);
	});

	it("200 si la institucion existe", async () => {
		setFakeDbResult([{ education_id: 1 }]);
		const res = await app.request(
			"/api/education/1",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(200);
	});

	it("404 si la institucion no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/education/999",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(404);
	});
});
