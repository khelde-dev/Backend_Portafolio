import { describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed } from "../support/helpers.js";

/**
 * Carreras: lo que garantiza la base (indice unico) y no el codigo. Si el
 * slug solo se validara "leyendo antes de escribir", dos peticiones
 * simultaneas podrian crear el mismo proyecto.
 */
const d1 = useRealD1();

const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const body = (slug: string) =>
	JSON.stringify({
		slug,
		category: "frontend",
		card_image: "/x.webp",
		title_default: slug,
		summary_default: "s",
		description_default: "d",
	});

const post = async (slug: string) =>
	call(
		"/api/projects",
		await adminAuthed({ method: "POST", body: body(slug) }),
	);

describe("escrituras simultaneas", () => {
	it("20 altas con el mismo slug: una gana y las demas son 409", async () => {
		const results = await Promise.all(
			Array.from({ length: 20 }, () => post("carrera")),
		);
		const statuses = results.map((r) => r.status);
		expect(statuses.filter((s) => s === 201)).toHaveLength(1);
		expect(statuses.filter((s) => s === 409)).toHaveLength(19);
		expect(statuses.filter((s) => s >= 500)).toHaveLength(0);

		const row = await d1.db
			.prepare("SELECT COUNT(*) AS n FROM projects WHERE slug = 'carrera'")
			.first<{ n: number }>();
		expect(row?.n).toBe(1);
	});

	it("altas simultaneas con slugs distintos se guardan todas", async () => {
		const results = await Promise.all(
			Array.from({ length: 25 }, (_, i) => post(`proyecto-${i}`)),
		);
		expect(results.every((r) => r.status === 201)).toBe(true);
		const row = await d1.db
			.prepare("SELECT COUNT(*) AS n FROM projects")
			.first<{ n: number }>();
		expect(row?.n).toBe(25);
	});

	it("borrados simultaneos del mismo id: uno borra, el resto es 404", async () => {
		const created = await (await post("a-borrar")).json<{
			data: { project_id: number };
		}>();
		const id = created.data.project_id;
		const results = await Promise.all(
			Array.from({ length: 10 }, async () =>
				call(`/api/projects/${id}`, await adminAuthed({ method: "DELETE" })),
			),
		);
		const statuses = results.map((r) => r.status).sort();
		expect(statuses.filter((s) => s === 200)).toHaveLength(1);
		expect(statuses.filter((s) => s === 404)).toHaveLength(9);
	});

	it("actualizaciones simultaneas dejan la fila en un estado coherente", async () => {
		const created = await (await post("coherente")).json<{
			data: { project_id: number };
		}>();
		const id = created.data.project_id;
		await Promise.all(
			Array.from({ length: 15 }, async (_, i) =>
				call(
					`/api/projects/${id}`,
					await adminAuthed({
						method: "PUT",
						body: JSON.stringify({
							...JSON.parse(body("coherente")),
							title_default: `titulo-${i}`,
							description_default: `descripcion-${i}`,
						}),
					}),
				),
			),
		);
		const row = await d1.db
			.prepare("SELECT title_default, description_default FROM projects")
			.first<{ title_default: string; description_default: string }>();
		// Gane quien gane, titulo y descripcion vienen de la MISMA peticion.
		expect(row?.title_default.split("-")[1]).toBe(
			row?.description_default.split("-")[1] ?? "",
		);
	});
});
