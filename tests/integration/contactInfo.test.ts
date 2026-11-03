import { describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { migrationStatements, useRealD1 } from "../support/d1.js";
import { adminAuthed, authed } from "../support/helpers.js";

const d1 = useRealD1();

const BODY = {
	github_url: "https://github.com/muke78",
	linkedin_url: "https://www.linkedin.com/in/alguien/",
	linkedin_name: "Erick Gonzalez",
	phone: "+52 55 1190 9105",
	email: "persona@example.com",
};

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const putJson = async (body: unknown) =>
	call(
		"/api/contact-info",
		await adminAuthed({ method: "PUT", body: JSON.stringify(body) }),
	);

describe("contact-info sobre una D1 real", () => {
	it("la migracion siembra la fila con los datos que tenia el sitio, y es idempotente", async () => {
		const seed = migrationStatements().filter((s) =>
			s.includes("INSERT OR IGNORE INTO `contact_info`"),
		);
		expect(seed).toHaveLength(1);
		await d1.db.prepare(seed[0]).run();
		await d1.db.prepare(seed[0]).run();
		const { results } = await d1.db
			.prepare("SELECT github_url, email FROM contact_info")
			.all<{ github_url: string; email: string }>();
		expect(results).toHaveLength(1);
		expect(results[0].github_url).toBe("https://github.com/muke78");
	});

	it("sin fila, la lectura publica da null", async () => {
		const res = await call("/api/contact-info", authed());
		expect(res.status).toBe(200);
		expect((await json(res)).data).toBeNull();
	});

	it("PUT crea la fila y despues la reemplaza; sigue habiendo una sola", async () => {
		expect((await putJson(BODY)).status).toBe(200);
		expect((await putJson({ ...BODY, email: "otra@example.com" })).status).toBe(
			200,
		);
		const { results } = await d1.db
			.prepare("SELECT id, email FROM contact_info")
			.all<{ id: number; email: string }>();
		expect(results).toEqual([{ id: 1, email: "otra@example.com" }]);

		const pub = await json(await call("/api/contact-info", authed()));
		expect(pub.data).toEqual({ ...BODY, email: "otra@example.com" });
		const admin = await json(
			await call("/api/contact-info/admin", await adminAuthed()),
		);
		expect(admin.data.contact_id).toBe(1);
	});

	it("un enlace que no es de GitHub no se guarda", async () => {
		const res = await putJson({
			...BODY,
			github_url: "https://evil.example/x",
		});
		expect(res.status).toBe(400);
		const { results } = await d1.db
			.prepare("SELECT id FROM contact_info")
			.all();
		expect(results).toHaveLength(0);
	});
});
