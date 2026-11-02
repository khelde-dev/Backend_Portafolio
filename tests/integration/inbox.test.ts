import { describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed, authed, uniqueIp } from "../support/helpers.js";

const d1 = useRealD1();

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const sendContact = (over: Record<string, unknown> = {}) =>
	call(
		"/api/contact-messages",
		authed({
			method: "POST",
			headers: { "cf-connecting-ip": uniqueIp() },
			body: JSON.stringify({
				name: "Ana",
				email: "ana@example.com",
				phone: "+52 55 1234 5678",
				...over,
			}),
		}),
	);

const sendComment = (over: Record<string, unknown> = {}) =>
	call(
		"/api/comments",
		authed({
			method: "POST",
			headers: { "cf-connecting-ip": uniqueIp() },
			body: JSON.stringify({
				name: "Luis",
				description: "Excelente trabajo, muy recomendable.",
				direction: "left",
				country_flag: "mx",
				country: "Mexico",
				...over,
			}),
		}),
	);

describe("bandeja de contacto", () => {
	it("el mensaje entra sin leer, se filtra, se responde y se borra", async () => {
		expect((await sendContact()).status).toBe(201);
		expect((await sendContact({ name: "Beto" })).status).toBe(201);

		const count = await json(
			await call("/api/contact-messages/unread-count", await adminAuthed()),
		);
		expect(count.data.unread).toBe(2);

		const all = await json(
			await call("/api/contact-messages", await adminAuthed()),
		);
		expect(all.data).toHaveLength(2);
		// Mas reciente primero.
		expect(all.data[0].message_id).toBeGreaterThan(all.data[1].message_id);
		const first = all.data[1];
		expect(first.status).toBe("unread");
		expect(first.more_information).toBeNull();

		const replied = await call(
			`/api/contact-messages/${first.message_id}`,
			await adminAuthed({
				method: "PUT",
				body: JSON.stringify({ status: "replied" }),
			}),
		);
		expect(replied.status).toBe(200);
		expect((await json(replied)).data.replied_at).toBeTruthy();

		const unread = await json(
			await call("/api/contact-messages?status=unread", await adminAuthed()),
		);
		expect(unread.data).toHaveLength(1);
		const count2 = await json(
			await call("/api/contact-messages/unread-count", await adminAuthed()),
		);
		expect(count2.data.unread).toBe(1);

		const del = await call(
			`/api/contact-messages/${first.message_id}`,
			await adminAuthed({ method: "DELETE" }),
		);
		expect(del.status).toBe(200);
		expect(
			(await json(await call("/api/contact-messages", await adminAuthed())))
				.data,
		).toHaveLength(1);
	});

	it("el publico no puede leer la bandeja ni el contador", async () => {
		await sendContact();
		for (const path of [
			"/api/contact-messages",
			"/api/contact-messages/unread-count",
		]) {
			expect((await call(path, authed())).status).toBe(401);
		}
	});

	it("un mensaje nuevo nunca nace como respondido", async () => {
		await sendContact({ status: "replied" });
		const row = await d1.db
			.prepare("SELECT status, replied_at FROM contact_messages")
			.first<{ status: string; replied_at: string | null }>();
		expect(row?.status).toBe("unread");
		expect(row?.replied_at).toBeNull();
	});
});

describe("comentarios con moderacion", () => {
	it("un comentario nuevo queda pendiente y no se ve hasta aprobarlo", async () => {
		expect((await sendComment()).status).toBe(201);

		const publicBefore = await json(await call("/api/comments", authed()));
		expect(publicBefore.data).toHaveLength(0);

		const admin = await json(
			await call("/api/comments/admin", await adminAuthed()),
		);
		expect(admin.data).toHaveLength(1);
		expect(admin.data[0].status).toBe("pending");

		const approve = await call(
			`/api/comments/${admin.data[0].comment_id}`,
			await adminAuthed({
				method: "PUT",
				body: JSON.stringify({ status: "published" }),
			}),
		);
		expect(approve.status).toBe(200);

		const publicAfter = await json(await call("/api/comments", authed()));
		expect(publicAfter.data).toHaveLength(1);
		expect(publicAfter.data[0].name).toBe("Luis");
	});

	it("el cliente no puede publicarse a si mismo", async () => {
		await sendComment({ status: "published" });
		const row = await d1.db
			.prepare("SELECT status FROM comments")
			.first<{ status: string }>();
		expect(row?.status).toBe("pending");
		expect(
			(await json(await call("/api/comments", authed()))).data,
		).toHaveLength(0);
	});

	it("ocultar un comentario lo saca del sitio", async () => {
		await sendComment();
		const id = (
			await json(await call("/api/comments/admin", await adminAuthed()))
		).data[0].comment_id;
		for (const status of ["published", "hidden"]) {
			await call(
				`/api/comments/${id}`,
				await adminAuthed({ method: "PUT", body: JSON.stringify({ status }) }),
			);
		}
		expect(
			(await json(await call("/api/comments", authed()))).data,
		).toHaveLength(0);
	});
});

describe("Acerca de (fila unica)", () => {
	const about = (title: string) =>
		JSON.stringify({
			image: "/Aboutme.webp",
			title_card_default: title,
			subtitle_default: "Quien soy",
			description_default: "Texto",
			translations: [{ locale: "en", title_card: `${title} EN` }],
		});

	it("la primera escritura crea y las siguientes actualizan la misma fila", async () => {
		for (const title of ["Uno", "Dos", "Tres"]) {
			const res = await call(
				"/api/about",
				await adminAuthed({ method: "PUT", body: about(title) }),
			);
			expect(res.status).toBe(200);
		}
		const rows = await d1.db
			.prepare("SELECT id, title_card_default FROM about")
			.all<{ id: number; title_card_default: string }>();
		expect(rows.results).toEqual([{ id: 1, title_card_default: "Tres" }]);

		const en = await json(await call("/api/about?currentLocale=en", authed()));
		expect(en.data.title_card).toBe("Tres EN");
	});

	it("sin datos, la lectura publica no revienta", async () => {
		const res = await call("/api/about?currentLocale=es", authed());
		expect(res.status).toBe(200);
	});
});
