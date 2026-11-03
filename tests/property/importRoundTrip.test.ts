import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { buildImportSql } from "../../scripts/tursoToD1.js";
import { migrationStatements } from "../support/d1.js";

/**
 * El importador de Turso arma SQL como texto, asi que es el unico lugar donde
 * un valor podria "escaparse" de su comilla. Se prueba con cadenas arbitrarias
 * (comillas, saltos de linea, puntos y coma, unicode) contra SQLite de verdad:
 * lo que entra tiene que salir identico y las tablas deben quedar intactas.
 */
const freshDb = () => {
	const db = new Database(":memory:");
	for (const sql of migrationStatements()) db.exec(sql);
	return db;
};

const nasty = fc.oneof(
	fc.string(),
	fc.stringMatching(/^['";\\\n\r\t%_ -]{0,20}$/),
	fc.constantFrom(
		"'; DROP TABLE projects; --",
		"L'Atelier",
		"''",
		'"quoted"',
		"semi;colon;\n--comment",
		"emoji 🚀 日本語",
		"\\",
	),
);

describe("buildImportSql contra SQLite real", () => {
	it("textos arbitrarios hacen el viaje de ida y vuelta sin cambios", () => {
		fc.assert(
			fc.property(nasty, nasty, nasty, (title, summary, name) => {
				const db = freshDb();
				const sql = buildImportSql({
					projects: [
						{
							id: 1,
							slug: "p",
							category: "frontend",
							card_image: "/a.webp",
							images_topics: "[]",
							title_default: title,
							description_default: summary,
							fork: 0,
						},
					],
					comments: [
						{
							id: 1,
							name,
							description: summary,
							direction: "left",
							country_flag: "mx",
							country: "Mexico",
							created_at: "2025-01-01 00:00:00",
						},
					],
				});
				db.exec(sql);

				const project = db
					.query("SELECT title_default, description_default FROM projects")
					.get() as { title_default: string; description_default: string };
				expect(project.title_default).toBe(title);
				expect(project.description_default).toBe(summary);

				const comment = db.query("SELECT name FROM comments").get() as {
					name: string;
				};
				expect(comment.name).toBe(name);

				const tables = db
					.query(
						"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
					)
					.get() as { n: number };
				expect(tables.n).toBe(9);
				db.close();
			}),
			{ numRuns: 150 },
		);
	});

	it("las traducciones con caracteres raros quedan como JSON valido", () => {
		fc.assert(
			fc.property(nasty, (text) => {
				const db = freshDb();
				db.exec(
					buildImportSql({
						projects: [
							{
								id: 1,
								slug: "p",
								category: "frontend",
								card_image: "/a.webp",
								images_topics: "[]",
								title_default: "t",
								description_default: "d",
								fork: 0,
							},
						],
						project_translations: [
							{ project_id: 1, locale: "en", title: text, description: text },
						],
					}),
				);
				const row = db.query("SELECT translations FROM projects").get() as {
					translations: string;
				};
				expect(JSON.parse(row.translations).en.title).toBe(text);
				db.close();
			}),
			{ numRuns: 150 },
		);
	});
});
