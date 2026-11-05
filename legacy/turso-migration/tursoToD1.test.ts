import { describe, expect, it } from "bun:test";
import { buildImportSql } from "./tursoToD1.js";

describe("buildImportSql (respaldo de Turso a D1)", () => {
	const sql = buildImportSql({
		projects: [
			{
				id: 1,
				slug: "mi-proyecto",
				category: "frontend",
				card_image: "a.webp",
				images_topics: '["react"]',
				link_repo: null,
				link_web: null,
				title_default: "L'Atelier",
				description_default: "Descripcion",
				fork: 1,
			},
		],
		project_translations: [
			{ project_id: 1, locale: "en", title: "Title", description: "Desc" },
			{ project_id: 1, locale: "fr", title: "Titre", description: "Texte" },
		],
		experience: [
			{
				id: 3,
				work_default: null,
				title_default: "Dev",
				subtitle_default: "Acme",
				img: "x.png",
				alt: "x",
				time_default: "2022",
				location_default: "CDMX",
			},
		],
		experience_translations: [
			{
				experience_id: 3,
				locale: "en",
				work: null,
				title: "Dev",
				subtitle: "Acme",
				time: "2022",
				location: "MX",
			},
		],
		comments: [
			{
				id: 9,
				name: "Ana",
				job: null,
				description: "Muy bien hecho todo",
				direction: "left",
				country_flag: "MX",
				country: "Mexico",
				created_at: "2026-01-01 10:00:00",
			},
		],
	});

	it("conserva los ids y escapa las comillas simples", () => {
		expect(sql).toContain("INSERT INTO `projects`");
		expect(sql).toContain("'L''Atelier'");
		expect(sql).toMatch(/VALUES \(1, 'mi-proyecto'/);
	});

	it("mete las traducciones en la misma fila, como JSON", () => {
		const line =
			sql.split("\n").find((l) => l.includes("INTO `projects`")) ?? "";
		expect(line).toContain(
			'"en":{"title":"Title","summary":"Desc","description":"Desc"}',
		);
		expect(line).toContain('"fr":{"title":"Titre"');
	});

	it("el texto viejo alimenta resumen y descripcion larga", () => {
		const line =
			sql.split("\n").find((l) => l.includes("INTO `projects`")) ?? "";
		expect(line.match(/'Descripcion'/g)?.length).toBe(2);
	});

	it("proyectos nacen publicados y fork pasa a 0/1", () => {
		expect(sql).toContain("'published'");
		expect(sql).toMatch(/'Descripcion', 'Descripcion', '\{/);
	});

	it("convierte experiencia y comentarios, con NULL para lo vacio", () => {
		expect(sql).toContain("INSERT INTO `experience`");
		expect(sql).toContain("NULL");
		const comment =
			sql.split("\n").find((l) => l.includes("INTO `comments`")) ?? "";
		expect(comment).toContain("'published'");
		expect(comment).toContain("'2026-01-01 10:00:00', '2026-01-01 10:00:00'");
	});

	it("una tabla ausente del respaldo no genera sentencias", () => {
		expect(sql).not.toContain("INTO `skills`");
		expect(sql).not.toContain("INTO `about`");
	});
});
