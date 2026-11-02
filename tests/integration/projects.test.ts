import { describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed, authed } from "../support/helpers.js";

const d1 = useRealD1();

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const project = (over: Record<string, unknown> = {}) => ({
	slug: "mi-proyecto",
	category: "frontend",
	card_image: "/mi-proyecto.webp",
	title_default: "Titulo",
	summary_default: "Resumen",
	description_default: "Descripcion larga",
	images_topics: ["react", "typescript"],
	gallery: ["/g1.webp", "/g2.webp"],
	translations: [
		{ locale: "en", title: "Title", summary: "Summary", description: "Long" },
	],
	...over,
});

const create = async (over: Record<string, unknown> = {}) =>
	call(
		"/api/projects",
		await adminAuthed({ method: "POST", body: JSON.stringify(project(over)) }),
	);

const publicList = async (locale = "es") =>
	(await json(await call(`/api/projects?currentLocale=${locale}`, authed())))
		.data.rows as Record<string, unknown>[];

describe("ciclo de vida de un proyecto (D1 real)", () => {
	it("crea, lista, actualiza y borra", async () => {
		const created = await create();
		expect(created.status).toBe(201);
		const { project_id } = (await json(created)).data;
		expect(typeof project_id).toBe("number");

		const rows = await publicList();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			slug: "mi-proyecto",
			title: "Titulo",
			summary: "Resumen",
			description: "Descripcion larga",
			images_topics: ["react", "typescript"],
			gallery: ["/g1.webp", "/g2.webp"],
		});

		const updated = await call(
			`/api/projects/${project_id}`,
			await adminAuthed({
				method: "PUT",
				body: JSON.stringify(project({ title_default: "Nuevo titulo" })),
			}),
		);
		expect(updated.status).toBe(200);
		expect((await publicList())[0].title).toBe("Nuevo titulo");

		const del = await call(
			`/api/projects/${project_id}`,
			await adminAuthed({ method: "DELETE" }),
		);
		expect(del.status).toBe(200);
		expect(await publicList()).toHaveLength(0);

		const again = await call(
			`/api/projects/${project_id}`,
			await adminAuthed({ method: "DELETE" }),
		);
		expect(again.status).toBe(404);
	});

	it("update sobre un id inexistente es 404 y no crea nada", async () => {
		const res = await call(
			"/api/projects/12345",
			await adminAuthed({ method: "PUT", body: JSON.stringify(project()) }),
		);
		expect(res.status).toBe(404);
		expect(await publicList()).toHaveLength(0);
	});

	it("el slug repetido es 409 y la base conserva solo uno", async () => {
		expect((await create()).status).toBe(201);
		const dup = await create({ title_default: "Otro" });
		expect(dup.status).toBe(409);
		expect((await json(dup)).message).toContain("slug");
		expect(await publicList()).toHaveLength(1);
	});

	it("cambiar el slug a uno ocupado es 409 y no modifica el original", async () => {
		await create({ slug: "uno" });
		const two = await json(await create({ slug: "dos" }));
		const res = await call(
			`/api/projects/${two.data.project_id}`,
			await adminAuthed({
				method: "PUT",
				body: JSON.stringify(project({ slug: "uno" })),
			}),
		);
		expect(res.status).toBe(409);
		const slugs = (await publicList()).map((r) => r.slug).sort();
		expect(slugs).toEqual(["dos", "uno"]);
	});

	it("update refresca updated_at y conserva created_at", async () => {
		const { data } = await json(await create());
		const read = () =>
			d1.db
				.prepare("SELECT created_at, updated_at FROM projects WHERE id = ?")
				.bind(data.project_id)
				.first<{ created_at: string; updated_at: string }>();
		const before = await read();
		await d1.db
			.prepare(
				"UPDATE projects SET updated_at = '2000-01-01 00:00:00' WHERE id = ?",
			)
			.bind(data.project_id)
			.run();
		await call(
			`/api/projects/${data.project_id}`,
			await adminAuthed({ method: "PUT", body: JSON.stringify(project()) }),
		);
		const after = await read();
		expect(after?.created_at).toBe(before?.created_at ?? "");
		expect(after?.updated_at).not.toBe("2000-01-01 00:00:00");
	});
});

describe("borradores y traducciones", () => {
	it("un borrador no sale en el sitio pero el CMS lo ve", async () => {
		await create({ slug: "oculto", status: "draft" });
		await create({ slug: "visible", status: "published" });
		expect((await publicList()).map((r) => r.slug)).toEqual(["visible"]);

		const admin = await json(
			await call("/api/projects/admin", await adminAuthed()),
		);
		expect(admin.data.map((r: { slug: string }) => r.slug).sort()).toEqual([
			"oculto",
			"visible",
		]);
	});

	it("resuelve el idioma pedido y cae al texto por defecto", async () => {
		await create();
		expect((await publicList("en"))[0]).toMatchObject({
			title: "Title",
			summary: "Summary",
			description: "Long",
		});
		expect((await publicList("fr"))[0].title).toBe("Titulo");
		expect((await publicList("es"))[0].title).toBe("Titulo");
	});

	it("una traduccion parcial no pisa el texto por defecto", async () => {
		await create({ translations: [{ locale: "en", title: "Only title" }] });
		const en = (await publicList("en"))[0];
		expect(en.title).toBe("Only title");
		expect(en.summary).toBe("Resumen");
	});

	it("respeta sort_order y desempata por id", async () => {
		await create({ slug: "c", sort_order: 2 });
		await create({ slug: "a", sort_order: 0 });
		await create({ slug: "b", sort_order: 0 });
		expect((await publicList()).map((r) => r.slug)).toEqual(["a", "b", "c"]);
	});

	it("la respuesta publica no expone columnas internas", async () => {
		await create();
		const row = (await publicList())[0];
		expect(Object.keys(row).sort()).toEqual(
			[
				"project_id",
				"slug",
				"category",
				"card_image",
				"gallery",
				"video_url",
				"images_topics",
				"link_repo",
				"link_web",
				"fork",
				"featured",
				"title",
				"summary",
				"description",
			].sort(),
		);
	});
});

describe("integridad de datos", () => {
	it("conserva unicode, emojis y comillas tal cual", async () => {
		const title = "Ñandú 日本語 🚀 \"comillas\" 'simples' y barra \\";
		await create({
			title_default: title,
			description_default: "línea1\nlínea2",
		});
		const row = (await publicList())[0];
		expect(row.title).toBe(title);
		expect(row.description).toBe("línea1\nlínea2");
	});

	it("guarda galerias largas completas y en orden", async () => {
		const gallery = Array.from({ length: 50 }, (_, i) => `/g${i}.webp`);
		await create({ gallery });
		expect((await publicList())[0].gallery).toEqual(gallery);
	});

	it("JSON danado en la base no tumba la lectura publica", async () => {
		await create();
		await d1.db
			.prepare(
				"UPDATE projects SET gallery = 'no-json', translations = '{rota'",
			)
			.run();
		const res = await call("/api/projects?currentLocale=en", authed());
		expect(res.status).toBe(200);
		const row = (await json(res)).data.rows[0];
		expect(row.gallery).toEqual([]);
		expect(row.title).toBe("Titulo");
	});
});
