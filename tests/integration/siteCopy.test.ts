import { describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { migrationStatements, useRealD1 } from "../support/d1.js";
import { adminAuthed, authed } from "../support/helpers.js";

const d1 = useRealD1();

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const BODY = {
	hero_image: "site/abc.webp",
	hero_image_alt_default: "Retrato",
	hero_label_default: "Desarrollador",
	hero_lead_default: "Presentacion",
	manifesto_text_default: "Manifiesto",
	meta_description_default: "Descripcion",
	translations: [
		{
			locale: "en",
			hero_image_alt: "Portrait",
			hero_label: "Developer",
		},
	],
};

const put = async (body: unknown) =>
	call(
		"/api/site-copy",
		await adminAuthed({ method: "PUT", body: JSON.stringify(body) }),
	);
const read = async (locale: string) =>
	json(await call(`/api/site-copy?currentLocale=${locale}`, authed()));

describe("site-copy sobre una D1 real", () => {
	it("la migracion siembra los textos y la foto que tenia el sitio, y es idempotente", async () => {
		const seed = migrationStatements().filter((s) =>
			s.includes("INSERT OR IGNORE INTO `site_copy`"),
		);
		expect(seed).toHaveLength(1);
		await d1.db.prepare(seed[0]).run();
		await d1.db.prepare(seed[0]).run();
		const { results } = await d1.db
			.prepare("SELECT hero_image, translations FROM site_copy")
			.all<{ hero_image: string; translations: string }>();
		expect(results).toHaveLength(1);
		expect(results[0].hero_image).toBe("Aboutme.webp");
		expect(Object.keys(JSON.parse(results[0].translations)).sort()).toEqual([
			"en",
			"fr",
		]);
	});

	it("sin fila, la lectura publica da null", async () => {
		expect((await read("es")).data).toBeNull();
	});

	it("cada idioma recibe lo suyo y lo que falta cae al espanol", async () => {
		expect((await put(BODY)).status).toBe(200);
		expect((await read("es")).data).toEqual({
			hero_image: "site/abc.webp",
			hero_image_alt: "Retrato",
			hero_label: "Desarrollador",
			hero_lead: "Presentacion",
			manifesto_text: "Manifiesto",
			meta_description: "Descripcion",
		});
		const en = (await read("en")).data;
		expect(en.hero_label).toBe("Developer");
		expect(en.hero_image_alt).toBe("Portrait");
		// Sin traduccion en frances: cae al espanol, y la foto es la misma para todos.
		const fr = (await read("fr")).data;
		expect(fr.hero_label).toBe("Desarrollador");
		expect(fr.hero_image).toBe("site/abc.webp");
	});

	it("PUT reemplaza la fila; sigue habiendo una sola", async () => {
		await put(BODY);
		await put({ ...BODY, hero_label_default: "Otro", translations: [] });
		const { results } = await d1.db
			.prepare("SELECT id FROM site_copy")
			.all<{ id: number }>();
		expect(results).toEqual([{ id: 1 }]);
		expect((await read("es")).data.hero_label).toBe("Otro");
	});

	it("una clave de imagen que parece URL no se guarda", async () => {
		for (const hero_image of [
			"https://evil.example/x.webp",
			"../x.webp",
			"//evil/x.webp",
		]) {
			expect((await put({ ...BODY, hero_image })).status).toBe(400);
		}
		expect((await read("es")).data).toBeNull();
	});

	it("falta de datos o textos pasados de largo se rechazan", async () => {
		expect((await put({})).status).toBe(400);
		expect(
			(await put({ ...BODY, hero_lead_default: "x".repeat(501) })).status,
		).toBe(400);
	});

	it("409 si la ficha cambio desde que se abrio, sin pisar nada", async () => {
		await put(BODY);
		await d1.db
			.prepare(
				"UPDATE site_copy SET updated_at = '2020-01-01 00:00:00' WHERE id = 1",
			)
			.run();
		expect(
			(
				await put({
					...BODY,
					hero_label_default: "A",
					updated_at: "2020-01-01 00:00:00",
				})
			).status,
		).toBe(200);
		const stale = await put({
			...BODY,
			hero_label_default: "B",
			updated_at: "2020-01-01 00:00:00",
		});
		expect(stale.status).toBe(409);
		expect((await read("es")).data.hero_label).toBe("A");
	});

	it("la foto del hero cuenta como 'en uso' en Medios y no se puede borrar (409)", async () => {
		await put(BODY);
		await d1.env.MEDIA.put("site/abc.webp", new Uint8Array([1, 2, 3]));
		const list = await json(
			await call("/api/media", await adminAuthed({ method: "GET" })),
		);
		const object = list.data.objects.find(
			(o: { key: string }) => o.key === "site/abc.webp",
		);
		expect(object.usedBy).toEqual([
			{
				resource: "site-copy",
				id: 1,
				label: "Textos del sitio",
				field: "hero_image",
			},
		]);
		const del = await call(
			"/api/media/site/abc.webp",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(del.status).toBe(409);
	});

	it("el admin lee todas las traducciones", async () => {
		await put(BODY);
		const admin = await json(
			await call("/api/site-copy/admin", await adminAuthed()),
		);
		expect(admin.data.translations.en.hero_label).toBe("Developer");
		expect(admin.data.site_copy_id).toBe(1);
	});
});
