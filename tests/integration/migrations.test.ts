import { describe, expect, it } from "bun:test";
import { migrationStatements, useRealD1 } from "../support/d1.js";

const d1 = useRealD1();

const names = async (type: "table" | "index") => {
	const { results } = await d1.db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
		)
		.bind(type)
		.all<{ name: string }>();
	return results.map((r) => r.name).sort();
};

describe("migraciones sobre una D1 real", () => {
	it("hay al menos una migracion", () => {
		expect(migrationStatements().length).toBeGreaterThan(0);
	});

	it("crea exactamente las tablas del portafolio", async () => {
		expect(await names("table")).toEqual([
			"about",
			"comments",
			"contact_messages",
			"education",
			"experience",
			"projects",
			"skills",
		]);
	});

	it("no existe tabla de usuarios ni de sesiones (la identidad es de Access)", async () => {
		const tables = await names("table");
		expect(tables.some((t) => /user|session|account|password/i.test(t))).toBe(
			false,
		);
	});

	it("el slug de proyectos es unico a nivel de base", async () => {
		expect(await names("index")).toContain("projects_slug_unique_idx");
	});

	it("las traducciones arrancan como objeto JSON vacio", async () => {
		await d1.db
			.prepare(
				"INSERT INTO projects (slug, category, card_image, title_default, summary_default, description_default) VALUES ('a','frontend','a.webp','t','s','d')",
			)
			.run();
		const row = await d1.db
			.prepare("SELECT translations, status, featured FROM projects")
			.first<{ translations: string; status: string; featured: number }>();
		expect(row?.translations).toBe("{}");
		expect(row?.status).toBe("published");
		expect(row?.featured).toBe(0);
	});
});
