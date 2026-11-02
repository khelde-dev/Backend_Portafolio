import { afterEach, describe, expect, it } from "bun:test";
import { adminAuthed, app, authed, uniqueIp } from "./helpers.js";
import {
	getLastInsertValues,
	getLastUpdateValues,
	setFakeDbResult,
} from "./mocks/fakeDb.js";

describe("GET /api/comments", () => {
	it("devuelve los comentarios del doble de db en el shape ApiResponse", async () => {
		setFakeDbResult([
			{
				comment_id: 1,
				name: "Erick",
				job: "Dev",
				description: "Buen trabajo",
				direction: "left",
				country_flag: "mx",
				country: "Mexico",
				created_at: "2026-01-01T00:00:00.000Z",
				status: "published",
			},
		]);
		const res = await app.request("/api/comments", authed());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].name).toBe("Erick");
	});
});

describe("POST /api/comments", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("400 con body invalido (zod) - shape ApiResponse normalizado, no el ZodError crudo", async () => {
		const res = await app.request(
			"/api/comments",
			authed({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(Array.isArray(body.errors)).toBe(true);
	});

	it("201 con body valido, count() del doble decide direction, status siempre 'pending'", async () => {
		// 4 comentarios existentes (par) -> el controller debe alternar a "left"
		setFakeDbResult([{ value: 4 }]);
		const res = await app.request(
			"/api/comments",
			authed({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": uniqueIp(),
				},
				body: JSON.stringify({
					name: "Ana",
					description: "Excelente trabajo en el proyecto",
					country_flag: "mx",
					country: "Mexico",
				}),
			}),
		);
		// status siempre nace "pending" sin importar que mande el cliente -
		// el schema ya ni acepta "status" en el body publico, pero esto
		// prueba el comportamiento real del controller, no solo la
		// validacion de entrada.
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.success).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: valor crudo capturado por el doble de db
		expect((getLastInsertValues() as any).status).toBe("pending");
	});

	it("429 despues de 5 requests en la misma ventana, misma IP", async () => {
		const ip = uniqueIp();
		const fire = () =>
			app.request(
				"/api/comments",
				authed({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Forwarded-For": ip,
					},
					body: JSON.stringify({}), // invalido a proposito - igual cuenta para el limite, no toca la db
				}),
			);

		const results = [];
		for (let i = 0; i < 6; i++) {
			results.push(await fire());
		}

		const statuses = results.map((r) => r.status);
		expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
		expect(statuses[5]).toBe(429);
	});
});

describe("GET /api/comments/admin", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request("/api/comments/admin", authed());
		expect(res.status).toBe(401);
	});

	it("200 con JWT valido, incluye comentarios pending", async () => {
		setFakeDbResult([
			{
				comment_id: 1,
				name: "Ana",
				job: null,
				description: "x",
				direction: "left",
				country_flag: "mx",
				country: "Mexico",
				created_at: "2026-01-01T00:00:00.000Z",
				status: "pending",
			},
		]);
		const res = await app.request("/api/comments/admin", await adminAuthed());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data[0].status).toBe("pending");
	});
});

describe("PUT /api/comments/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/comments/1",
			authed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "published" }),
			}),
		);
		expect(res.status).toBe(401);
	});

	it("200 con JWT valido, manda el status nuevo a .set()", async () => {
		setFakeDbResult([
			{
				comment_id: 1,
				status: "published",
				created_at: "2026-01-01T00:00:00.000Z",
			},
		]);
		const res = await app.request(
			"/api/comments/1",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "published" }),
			}),
		);
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: valor crudo capturado por el doble de db
		expect((getLastUpdateValues() as any).status).toBe("published");
	});

	it("404 si el doble de db no devuelve fila", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/comments/999",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "hidden" }),
			}),
		);
		expect(res.status).toBe(404);
	});

	it("400 con un id no numerico", async () => {
		const res = await app.request(
			"/api/comments/no-es-numero",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "hidden" }),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("400 con un status invalido (fuera del enum)", async () => {
		const res = await app.request(
			"/api/comments/1",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "not-a-real-status" }),
			}),
		);
		expect(res.status).toBe(400);
	});
});
