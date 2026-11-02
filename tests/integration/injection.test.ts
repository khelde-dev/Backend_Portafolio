import { describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed, authed, uniqueIp } from "../support/helpers.js";

/**
 * Inyeccion SQL contra una base SQLite real. Con la base falsa de los tests
 * unitarios estas pruebas no demostrarian nada: aqui, si algun valor se
 * concatenara en una sentencia, una tabla desapareceria o una consulta
 * devolveria filas ajenas.
 */
const d1 = useRealD1();

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const PAYLOADS = [
	"'; DROP TABLE projects; --",
	'" OR "1"="1',
	"' OR '1'='1' --",
	"'); DELETE FROM comments; --",
	"1; DROP TABLE contact_messages",
	"' UNION SELECT name, sql, 1, 1, 1, 1, 1, 1 FROM sqlite_master --",
	"Robert'); DROP TABLE students;--",
	"\\'; DROP TABLE about; --",
	"%' OR 1=1 --",
	"x'||(SELECT name FROM sqlite_master LIMIT 1)||'",
];

const tableCount = async () =>
	(
		await d1.db
			.prepare(
				"SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
			)
			.first<{ n: number }>()
	)?.n;

describe("los valores son datos, nunca SQL", () => {
	for (const payload of PAYLOADS) {
		const label = payload.slice(0, 32);

		it(`proyecto con titulo ${JSON.stringify(label)}`, async () => {
			const res = await call(
				"/api/projects",
				await adminAuthed({
					method: "POST",
					body: JSON.stringify({
						slug: "inyeccion",
						category: "frontend",
						card_image: "/x.webp",
						title_default: payload,
						summary_default: payload,
						description_default: payload,
						images_topics: [payload],
						translations: [{ locale: "en", title: payload }],
					}),
				}),
			);
			expect(res.status).toBe(201);
			expect(await tableCount()).toBe(7);

			const rows = (
				await json(await call("/api/projects?currentLocale=en", authed()))
			).data.rows;
			expect(rows).toHaveLength(1);
			expect(rows[0].title).toBe(payload);
			expect(rows[0].description).toBe(payload);
			expect(rows[0].images_topics).toEqual([payload]);
		});

		it(`mensaje de contacto con nombre ${JSON.stringify(label)}`, async () => {
			const res = await call(
				"/api/contact-messages",
				authed({
					method: "POST",
					headers: { "cf-connecting-ip": uniqueIp() },
					body: JSON.stringify({
						name: payload.slice(0, 100),
						email: "ana@example.com",
						phone: "+52 55 1234 5678",
						more_information: payload,
					}),
				}),
			);
			expect(res.status).toBe(201);
			expect(await tableCount()).toBe(7);

			const inbox = await json(
				await call("/api/contact-messages", await adminAuthed()),
			);
			expect(inbox.data).toHaveLength(1);
			expect(inbox.data[0].more_information).toBe(payload);
		});

		it(`comentario con descripcion ${JSON.stringify(label)}`, async () => {
			const res = await call(
				"/api/comments",
				authed({
					method: "POST",
					headers: { "cf-connecting-ip": uniqueIp() },
					body: JSON.stringify({
						name: "Ana",
						description: payload.padEnd(14, "."),
						direction: "left",
						country_flag: "mx",
						country: "Mexico",
					}),
				}),
			);
			expect(res.status).toBe(201);
			expect(await tableCount()).toBe(7);
			const stored = await d1.db
				.prepare("SELECT description FROM comments")
				.first<{ description: string }>();
			expect(stored?.description).toBe(payload.padEnd(14, "."));
		});
	}

	it("los ids en la ruta nunca llegan a la base si no son enteros", async () => {
		await d1.db
			.prepare(
				"INSERT INTO projects (slug, category, card_image, title_default, summary_default, description_default) VALUES ('a','frontend','/a.webp','t','s','d'), ('b','frontend','/b.webp','t','s','d')",
			)
			.run();
		for (const id of [
			"1 OR 1=1",
			"1;DELETE FROM projects",
			"%27 OR %271%27=%271",
		]) {
			const res = await call(
				`/api/projects/${id.replaceAll(" ", "%20")}`,
				await adminAuthed({ method: "DELETE" }),
			);
			expect(res.status).toBe(400);
		}
		const left = await d1.db
			.prepare("SELECT COUNT(*) AS n FROM projects")
			.first<{ n: number }>();
		expect(left?.n).toBe(2);
	});

	it("el filtro ?status no admite SQL y la bandeja sigue entera", async () => {
		const res = await call(
			"/api/contact-messages?status=unread'%20OR%20'1'='1",
			await adminAuthed(),
		);
		expect(res.status).toBe(400);
	});

	it("un slug con comillas no pasa la validacion y no toca la base", async () => {
		const res = await call(
			"/api/projects",
			await adminAuthed({
				method: "POST",
				body: JSON.stringify({
					slug: "a'; DROP TABLE projects;--",
					category: "frontend",
					card_image: "/x.webp",
					title_default: "t",
					summary_default: "s",
					description_default: "d",
				}),
			}),
		);
		expect(res.status).toBe(400);
		expect(await tableCount()).toBe(7);
	});
});
