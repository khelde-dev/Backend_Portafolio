import { describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed, authed } from "../support/helpers.js";

const d1 = useRealD1();

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const order = async (resource: string, body: unknown) =>
	call(
		`/api/${resource}/order`,
		await adminAuthed({ method: "PUT", body: JSON.stringify(body) }),
	);

const seed = async (
	table: string,
	columns: string,
	values: string,
	n: number,
) => {
	const ids: number[] = [];
	for (let i = 0; i < n; i++) {
		const result = await d1.db
			.prepare(`INSERT INTO ${table} (${columns}) VALUES (${values})`)
			.bind(
				...Array(values.split(",").length).fill(
					`${table}-${i}-${crypto.randomUUID()}`,
				),
			)
			.run();
		ids.push(result.meta.last_row_id as number);
	}
	return ids;
};

const sortOf = async (table: string, id: number) =>
	(
		await d1.db
			.prepare(`SELECT sort_order FROM ${table} WHERE id = ?`)
			.bind(id)
			.first<{ sort_order: number }>()
	)?.sort_order;

const RESOURCES = [
	{ path: "skills", table: "skills", columns: "title_default", values: "?" },
	{
		path: "experiences",
		table: "experience",
		columns:
			"title_default, subtitle_default, img, alt, time_default, location_default",
		values: "?, ?, ?, ?, ?, ?",
	},
	{
		path: "education",
		table: "education",
		columns:
			"institution_default, subtitle_default, description_default, image, period_default",
		values: "?, ?, ?, ?, ?",
	},
	{
		path: "projects",
		table: "projects",
		columns:
			"slug, category, card_image, title_default, summary_default, description_default",
		values: "?, 'frontend', ?, ?, ?, ?",
	},
] as const;

describe("reordenar en lote", () => {
	for (const resource of RESOURCES) {
		it(`${resource.path}: cambia el orden de todas las filas de una vez`, async () => {
			// El `values` de projects mezcla un literal: se arma a mano para sus 5 parametros.
			const ids =
				resource.path === "projects"
					? await Promise.all(
							[0, 1, 2].map(
								async (i) =>
									(
										await d1.db
											.prepare(
												"INSERT INTO projects (slug, category, card_image, title_default, summary_default, description_default) VALUES (?, 'frontend', 'a.webp', 'T', 'S', 'D')",
											)
											.bind(`slug-${i}-${crypto.randomUUID()}`)
											.run()
									).meta.last_row_id as number,
							),
						)
					: await seed(resource.table, resource.columns, resource.values, 3);

			const res = await order(
				resource.path,
				ids.map((id, i) => ({ id, sort_order: ids.length - i })),
			);
			expect(res.status).toBe(200);
			expect((await json(res)).data).toEqual({ updated: 3, requested: 3 });
			for (const [i, id] of ids.entries()) {
				expect(await sortOf(resource.table, id)).toBe(ids.length - i);
			}
		});
	}

	it("'order' no se confunde con un id (no responde 400 de id invalido)", async () => {
		const res = await order("skills", [{ id: 1, sort_order: 0 }]);
		expect(res.status).toBe(200);
	});

	it("un id que ya no existe se cuenta aparte y no rompe el resto", async () => {
		const [a] = await seed("skills", "title_default", "?", 1);
		const res = await order("skills", [
			{ id: a, sort_order: 7 },
			{ id: 99999, sort_order: 1 },
		]);
		expect(res.status).toBe(200);
		expect((await json(res)).data).toEqual({ updated: 1, requested: 2 });
		expect(await sortOf("skills", a)).toBe(7);
	});

	it("rechaza listas vacias, ids repetidos, valores raros y demasiados elementos (400)", async () => {
		const bad: unknown[] = [
			[],
			[
				{ id: 1, sort_order: 0 },
				{ id: 1, sort_order: 1 },
			],
			[{ id: 0, sort_order: 0 }],
			[{ id: 1, sort_order: -1 }],
			[{ id: 1.5, sort_order: 0 }],
			[{ id: "1", sort_order: 0 }],
			Array.from({ length: 201 }, (_, i) => ({ id: i + 1, sort_order: i })),
			{ id: 1, sort_order: 0 },
		];
		for (const body of bad) {
			expect((await order("skills", body)).status).toBe(400);
		}
	});

	it("solo toca sort_order: el resto de la fila queda igual", async () => {
		const [id] = await seed("skills", "title_default", "?", 1);
		const before = await d1.db
			.prepare("SELECT title_default, images_topics FROM skills WHERE id = ?")
			.bind(id)
			.first();
		await order("skills", [{ id, sort_order: 5 }]);
		const after = await d1.db
			.prepare("SELECT title_default, images_topics FROM skills WHERE id = ?")
			.bind(id)
			.first();
		expect(after).toEqual(before);
	});

	it("exige Access (401) en las cuatro rutas", async () => {
		for (const path of ["projects", "experiences", "education", "skills"]) {
			const res = await call(
				`/api/${path}/order`,
				authed({
					method: "PUT",
					body: JSON.stringify([{ id: 1, sort_order: 0 }]),
				}),
			);
			expect(res.status).toBe(401);
		}
	});
});
