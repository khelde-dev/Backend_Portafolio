import { describe, expect, it, spyOn } from "bun:test";
import realApp from "../../src/index.js";
import { AUDIT_RETENTION, auditLog } from "../../src/lib/auditLog.js";
import { createDb } from "../../src/lib/db.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed } from "../support/helpers.js";

const d1 = useRealD1();

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const CONTACT = {
	github_url: "https://github.com/muke78",
	linkedin_url: "https://www.linkedin.com/in/alguien/",
	linkedin_name: "Erick Gonzalez",
	phone: "+52 55 1190 9105",
	email: "persona@example.com",
};

interface Row {
	id: number;
	admin_email: string;
	action: string;
	resource: string;
	resource_id: string;
	summary: string | null;
}

const rows = async () =>
	(await d1.db.prepare("SELECT * FROM audit_log ORDER BY id").all<Row>())
		.results;

describe("audit_log sobre una D1 real", () => {
	it("una escritura del CMS deja su fila, con el correo del JWT", async () => {
		const log = spyOn(console, "log").mockImplementation(() => {});
		const res = await call(
			"/api/contact-info",
			await adminAuthed(
				{ method: "PUT", body: JSON.stringify(CONTACT) },
				{ email: "yo@example.com" },
			),
		);
		log.mockRestore();
		expect(res.status).toBe(200);
		const [row] = await rows();
		expect(row).toMatchObject({
			admin_email: "yo@example.com",
			action: "update",
			resource: "contact-info",
			resource_id: "1",
		});
	});

	it("una escritura que falla no deja historial", async () => {
		const res = await call(
			"/api/contact-info",
			await adminAuthed({
				method: "PUT",
				body: JSON.stringify({
					...CONTACT,
					github_url: "https://evil.example",
				}),
			}),
		);
		expect(res.status).toBe(400);
		expect(await rows()).toHaveLength(0);
	});

	it("GET /audit devuelve lo mas nuevo primero y respeta el limite", async () => {
		const db = createDb(d1.env);
		const log = spyOn(console, "log").mockImplementation(() => {});
		for (const n of [1, 2, 3]) {
			await auditLog({
				db,
				adminEmail: "yo@example.com",
				action: "create",
				resource: "projects",
				resourceId: n,
				summary: `Proyecto ${n}`,
			});
		}
		log.mockRestore();
		const res = await call("/api/audit?limit=2", await adminAuthed());
		const body = await json(res);
		expect(body.data.map((r: { summary: string }) => r.summary)).toEqual([
			"Proyecto 3",
			"Proyecto 2",
		]);
	});

	it(`conserva solo las ultimas ${AUDIT_RETENTION} filas`, async () => {
		const stmt = d1.db.prepare(
			"INSERT INTO audit_log (admin_email, action, resource, resource_id) VALUES ('yo@example.com','update','projects',?)",
		);
		await d1.db.batch(
			Array.from({ length: AUDIT_RETENTION + 5 }, (_, i) =>
				stmt.bind(String(i)),
			),
		);
		const log = spyOn(console, "log").mockImplementation(() => {});
		await auditLog({
			db: createDb(d1.env),
			adminEmail: "yo@example.com",
			action: "delete",
			resource: "projects",
			resourceId: "ultimo",
		});
		log.mockRestore();
		const all = await rows();
		expect(all).toHaveLength(AUDIT_RETENTION);
		expect(all.at(-1)?.resource_id).toBe("ultimo");
		// Se fueron las mas viejas, no las nuevas.
		expect(all[0].resource_id).toBe("6");
	});
});
