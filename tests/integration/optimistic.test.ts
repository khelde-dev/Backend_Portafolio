import { describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { STALE_MESSAGE } from "../../src/lib/optimistic.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed } from "../support/helpers.js";

const d1 = useRealD1();

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const send = async (method: string, path: string, body: unknown) =>
	call(path, await adminAuthed({ method, body: JSON.stringify(body) }));

const project = (over: Record<string, unknown> = {}) => ({
	slug: "mi-proyecto",
	category: "frontend",
	card_image: "/mi-proyecto.webp",
	title_default: "Titulo",
	summary_default: "Resumen",
	description_default: "Descripcion larga",
	images_topics: [],
	gallery: [],
	translations: [],
	...over,
});

const OLD = "2020-01-01 00:00:00";

/** Un proyecto con un `updated_at` viejo y fijo, para que la prueba no dependa del reloj. */
const seedProject = async () => {
	const created = await json(await send("POST", "/api/projects", project()));
	const id = created.data.project_id as number;
	await d1.db
		.prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
		.bind(OLD, id)
		.run();
	return id;
};

describe("edicion simultanea de un proyecto (D1 real)", () => {
	it("con el updated_at que leyo guarda, y el siguiente guardado con el mismo viejo da 409", async () => {
		const id = await seedProject();
		const first = await send("PUT", `/api/projects/${id}`, {
			...project({ title_default: "Pestana A" }),
			updated_at: OLD,
		});
		expect(first.status).toBe(200);

		const second = await send("PUT", `/api/projects/${id}`, {
			...project({ title_default: "Pestana B" }),
			updated_at: OLD,
		});
		expect(second.status).toBe(409);
		expect((await json(second)).message).toBe(STALE_MESSAGE);

		// Nada se piso: sigue lo que guardo la primera pestana.
		const row = await d1.db
			.prepare("SELECT title_default FROM projects WHERE id = ?")
			.bind(id)
			.first<{ title_default: string }>();
		expect(row?.title_default).toBe("Pestana A");
	});

	it("la respuesta trae el updated_at nuevo, con el que se puede guardar de nuevo", async () => {
		const id = await seedProject();
		const first = await json(
			await send("PUT", `/api/projects/${id}`, {
				...project(),
				updated_at: OLD,
			}),
		);
		const next = first.data.updated_at as string;
		expect(next).not.toBe(OLD);
		const again = await send("PUT", `/api/projects/${id}`, {
			...project({ title_default: "Otra vez" }),
			updated_at: next,
		});
		expect(again.status).toBe(200);
	});

	it("sin updated_at sigue siendo un reemplazo completo, como antes", async () => {
		const id = await seedProject();
		const res = await send(
			"PUT",
			`/api/projects/${id}`,
			project({ title_default: "Sin comprobar" }),
		);
		expect(res.status).toBe(200);
	});

	it("un id que no existe es 404, no 409", async () => {
		const res = await send("PUT", "/api/projects/9999", {
			...project(),
			updated_at: OLD,
		});
		expect(res.status).toBe(404);
	});

	it("el updated_at de un POST no se guarda como dato de la fila", async () => {
		const created = await json(
			await send("POST", "/api/projects", {
				...project({ slug: "otro" }),
				updated_at: OLD,
			}),
		);
		expect(created.data.updated_at).not.toBe(OLD);
	});
});

const CONTACT = {
	github_url: "https://github.com/muke78",
	linkedin_url: "https://www.linkedin.com/in/alguien/",
	linkedin_name: "Erick Gonzalez",
	phone: "+52 55 1190 9105",
	email: "persona@example.com",
};

describe("edicion simultanea de las fichas unicas (D1 real)", () => {
	it("contacto: guarda con el updated_at leido y da 409 si ya cambio", async () => {
		await send("PUT", "/api/contact-info", CONTACT);
		await d1.db
			.prepare("UPDATE contact_info SET updated_at = ? WHERE id = 1")
			.bind(OLD)
			.run();

		const ok = await send("PUT", "/api/contact-info", {
			...CONTACT,
			email: "a@example.com",
			updated_at: OLD,
		});
		expect(ok.status).toBe(200);

		const stale = await send("PUT", "/api/contact-info", {
			...CONTACT,
			email: "b@example.com",
			updated_at: OLD,
		});
		expect(stale.status).toBe(409);
		const row = await d1.db
			.prepare("SELECT email FROM contact_info WHERE id = 1")
			.first<{ email: string }>();
		expect(row?.email).toBe("a@example.com");
	});

	it("contacto: la primera vez (aun no hay fila) guarda aunque venga un updated_at", async () => {
		const res = await send("PUT", "/api/contact-info", {
			...CONTACT,
			updated_at: OLD,
		});
		expect(res.status).toBe(200);
	});

	it("sobre mi: lo mismo", async () => {
		const about = {
			image: "/a.webp",
			title_card_default: "Hola",
			subtitle_default: "Soy",
			description_default: "Desarrollador",
			translations: [],
		};
		expect((await send("PUT", "/api/about", about)).status).toBe(200);
		await d1.db
			.prepare("UPDATE about SET updated_at = ? WHERE id = 1")
			.bind(OLD)
			.run();
		expect(
			(await send("PUT", "/api/about", { ...about, updated_at: OLD })).status,
		).toBe(200);
		expect(
			(await send("PUT", "/api/about", { ...about, updated_at: OLD })).status,
		).toBe(409);
	});
});
