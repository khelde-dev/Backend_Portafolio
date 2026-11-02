import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	getLastInsertValues,
	getLastUpdateValues,
	setFakeDbResult,
} from "../support/fakeDb.js";
import { adminAuthed, app, authed, uniqueIp } from "../support/helpers.js";

describe("POST /api/contact-messages", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("400 con body invalido (zod) - reemplaza al /tlgrm viejo, que no validaba nada", async () => {
		const res = await app.request(
			"/api/contact-messages",
			authed({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": uniqueIp(),
				},
				body: JSON.stringify({ name: "Ana" }), // sin email/phone/more_information
			}),
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(Array.isArray(body.errors)).toBe(true);
	});

	it("201 con body valido, status siempre 'unread', cero llamadas de red (ya no hay Telegram)", async () => {
		const fetchSpy = spyOn(globalThis, "fetch");
		setFakeDbResult([
			{
				message_id: 1,
				name: "Ana",
				email: "ana@example.com",
				phone: "+52 555 555 5555",
				more_information: "Quiero cotizar un proyecto",
				status: "unread",
				created_at: "2026-01-01T00:00:00.000Z",
			},
		]);

		const res = await app.request(
			"/api/contact-messages",
			authed({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": uniqueIp(),
				},
				body: JSON.stringify({
					name: "Ana",
					email: "ana@example.com",
					phone: "+52 555 555 5555",
					more_information: "Quiero cotizar un proyecto",
				}),
			}),
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.success).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: valor crudo capturado por el doble de db
		expect((getLastInsertValues() as any).status).toBe("unread");
		// El modulo de Telegram se elimino por completo - este endpoint no
		// deberia disparar ningun fetch saliente.
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("429 despues de 5 requests en la misma ventana, misma IP", async () => {
		const ip = uniqueIp();
		const fire = () =>
			app.request(
				"/api/contact-messages",
				authed({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Forwarded-For": ip,
					},
					body: JSON.stringify({ name: "Ana" }), // invalido a proposito - igual cuenta para el limite
				}),
			);

		const results = [];
		for (let i = 0; i < 6; i++) {
			results.push(await fire());
		}
		expect(results[5].status).toBe(429);
	});
});

describe("GET /api/contact-messages (admin)", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request("/api/contact-messages", authed());
		expect(res.status).toBe(401);
	});

	it("200 con JWT valido", async () => {
		setFakeDbResult([
			{
				message_id: 1,
				name: "Ana",
				email: "ana@example.com",
				phone: "+52 555 555 5555",
				more_information: "x",
				status: "unread",
				created_at: "2026-01-01T00:00:00.000Z",
			},
		]);
		const res = await app.request("/api/contact-messages", await adminAuthed());
		expect(res.status).toBe(200);
	});
});

describe("PUT /api/contact-messages/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("401 sin X-Admin-JWT", async () => {
		const res = await app.request(
			"/api/contact-messages/1",
			authed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "read" }),
			}),
		);
		expect(res.status).toBe(401);
	});

	it("200 con JWT valido, manda el status nuevo a .set()", async () => {
		setFakeDbResult([{ message_id: 1, status: "read" }]);
		const res = await app.request(
			"/api/contact-messages/1",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "read" }),
			}),
		);
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: valor crudo capturado por el doble de db
		expect((getLastUpdateValues() as any).status).toBe("read");
	});

	it("404 si el doble de db no devuelve fila", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/contact-messages/999",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "replied" }),
			}),
		);
		expect(res.status).toBe(404);
	});

	it("400 con un status invalido (fuera del enum)", async () => {
		const res = await app.request(
			"/api/contact-messages/1",
			await adminAuthed({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "not-a-real-status" }),
			}),
		);
		expect(res.status).toBe(400);
	});
});

describe("GET /api/contact-messages (bandeja del admin)", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("200 con todos los mensajes", async () => {
		setFakeDbResult([{ message_id: 2 }, { message_id: 1 }]);
		const res = await app.request("/api/contact-messages", await adminAuthed());
		expect(res.status).toBe(200);
		expect((await res.json()).data).toHaveLength(2);
	});

	it("200 filtrando por estado valido", async () => {
		setFakeDbResult([{ message_id: 2, status: "unread" }]);
		const res = await app.request(
			"/api/contact-messages?status=unread",
			await adminAuthed(),
		);
		expect(res.status).toBe(200);
	});

	it("400 con un estado que no existe", async () => {
		const res = await app.request(
			"/api/contact-messages?status=archivado",
			await adminAuthed(),
		);
		expect(res.status).toBe(400);
	});
});

describe("GET /api/contact-messages/unread-count", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("devuelve cuantos mensajes faltan por leer", async () => {
		setFakeDbResult([{ value: 3 }]);
		const res = await app.request(
			"/api/contact-messages/unread-count",
			await adminAuthed(),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).data).toEqual({ unread: 3 });
	});

	it("0 cuando no hay nada", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/contact-messages/unread-count",
			await adminAuthed(),
		);
		expect((await res.json()).data).toEqual({ unread: 0 });
	});

	it("401 sin sesion de Access", async () => {
		const res = await app.request(
			"/api/contact-messages/unread-count",
			authed(),
		);
		expect(res.status).toBe(401);
	});
});

describe("DELETE /api/contact-messages/:id", () => {
	afterEach(() => {
		setFakeDbResult([]);
	});

	it("404 si el mensaje no existe", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/contact-messages/999",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(404);
	});

	it("200 y devuelve el mensaje borrado", async () => {
		setFakeDbResult([{ message_id: 5, name: "Spam" }]);
		const res = await app.request(
			"/api/contact-messages/5",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).data.message_id).toBe(5);
	});

	it("401 sin sesion de Access", async () => {
		const res = await app.request(
			"/api/contact-messages/5",
			authed({ method: "DELETE" }),
		);
		expect(res.status).toBe(401);
	});
});
