import { afterEach, describe, expect, it } from "bun:test";
import { adminAuthed, app, authed } from "./helpers.js";
import { resetFakeDbCalls, setFakeDbResult } from "./mocks/fakeDb.js";

const VALID_BODY = {
	image: "/test.webp",
	title_card_default: "Titulo",
	subtitle_default: "Subtitulo",
	description_default: "Descripcion",
	translations: [],
};

describe("GET /api/about", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("400 sin currentLocale", async () => {
		const res = await app.request("/api/about", authed());
		expect(res.status).toBe(400);
	});

	it("200 con currentLocale valido", async () => {
		setFakeDbResult([{ about_id: 1, image: "/test.webp" }]);
		const res = await app.request("/api/about?currentLocale=es", authed());
		expect(res.status).toBe(200);
	});

	it("200 con data null si el singleton todavia no fue sembrado", async () => {
		setFakeDbResult([]);
		const res = await app.request("/api/about?currentLocale=es", authed());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toBeNull();
	});
});

describe("PUT /api/about", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/about",
			authed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(VALID_BODY),
			}),
		);
		expect(res.status).toBe(401);
	});

	it("400 con body invalido", async () => {
		const res = await app.request(
			"/api/about",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("200 con body valido - upsert (funciona sin fila previa)", async () => {
		setFakeDbResult([{ about_id: 1, ...VALID_BODY }]);
		const res = await app.request(
			"/api/about",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(VALID_BODY),
			}),
		);
		expect(res.status).toBe(200);
	});
});
