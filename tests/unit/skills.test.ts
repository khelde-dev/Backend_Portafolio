import { afterEach, describe, expect, it } from "bun:test";
import {
	getInsertCalls,
	resetFakeDbCalls,
	setFakeDbResult,
} from "../support/fakeDb.js";
import { adminAuthed, app, authed } from "../support/helpers.js";

const VALID_BODY = {
	title_default: "Categoria de prueba",
	images_topics: ["react", "typescript"],
	translations: [{ locale: "es", title: "Categoria de prueba" }],
};

describe("GET /api/skills", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("400 sin currentLocale", async () => {
		const res = await app.request("/api/skills", authed());
		expect(res.status).toBe(400);
	});

	it("200 con currentLocale valido, images_topics parseado como array", async () => {
		setFakeDbResult([
			{ skill_id: 1, title: "React", images_topics: '["react","astro"]' },
		]);
		const res = await app.request("/api/skills?currentLocale=es", authed());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data[0].images_topics).toEqual(["react", "astro"]);
	});
});

describe("POST /api/skills", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/skills",
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
			"/api/skills",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("201 con body valido, images_topics se manda como JSON string a .values()", async () => {
		setFakeDbResult([{ skill_id: 1, title_default: "Categoria de prueba" }]);
		const res = await app.request(
			"/api/skills",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(VALID_BODY),
			}),
		);
		expect(res.status).toBe(201);
		const [mainInsert] = getInsertCalls() as { images_topics: string }[];
		expect(mainInsert.images_topics).toBe(
			JSON.stringify(["react", "typescript"]),
		);
	});
});

describe("PUT /api/skills/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("404 si la categoria no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/skills/999",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(VALID_BODY),
			}),
		);
		expect(res.status).toBe(404);
	});
});

describe("DELETE /api/skills/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/skills/1",
			authed({ method: "DELETE" }),
		);
		expect(res.status).toBe(401);
	});

	it("200 si la categoria existe", async () => {
		setFakeDbResult([{ skill_id: 1, images_topics: '["react"]' }]);
		const res = await app.request(
			"/api/skills/1",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(200);
	});

	it("404 si la categoria no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/skills/999",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(404);
	});
});
