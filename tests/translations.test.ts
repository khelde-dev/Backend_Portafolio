import { afterEach, describe, expect, it } from "bun:test";
import {
	hasDuplicateLocales,
	parseJson,
	toTranslationMap,
	translationFor,
} from "../src/lib/translations.js";
import { app, authed } from "./helpers.js";
import { resetFakeDbCalls, setFakeDbResult } from "./mocks/fakeDb.js";

describe("lib/translations", () => {
	it("parseJson devuelve el respaldo ante vacio o JSON roto", () => {
		expect(parseJson<number[]>("[1,2]", [])).toEqual([1, 2]);
		expect(parseJson("", ["x"])).toEqual(["x"]);
		expect(parseJson(undefined, {})).toEqual({});
		expect(parseJson("{no", { a: 1 })).toEqual({ a: 1 });
	});

	it("toTranslationMap indexa por idioma y quita la clave locale", () => {
		expect(
			toTranslationMap([
				{ locale: "en", title: "Hi" },
				{ locale: "fr", title: "Salut" },
			]),
		).toEqual({ en: { title: "Hi" }, fr: { title: "Salut" } });
	});

	it("translationFor ignora valores vacios para no pisar el default", () => {
		const raw = JSON.stringify({
			en: { title: "Hi", summary: "", work: null },
		});
		expect(translationFor(raw, "en")).toEqual({ title: "Hi" });
		expect(translationFor(raw, "fr")).toEqual({});
		expect(translationFor("no-json", "en")).toEqual({});
	});

	it("hasDuplicateLocales detecta idiomas repetidos", () => {
		expect(hasDuplicateLocales([{ locale: "en" }, { locale: "es" }])).toBe(
			false,
		);
		expect(hasDuplicateLocales([{ locale: "en" }, { locale: "en" }])).toBe(
			true,
		);
	});
});

const project = {
	project_id: 1,
	slug: "demo",
	category: "frontend",
	status: "published",
	card_image: "projects/demo.webp",
	gallery: '["projects/a.webp"]',
	images_topics: '["react"]',
	fork: false,
	featured: true,
	title_default: "Titulo",
	summary_default: "Resumen",
	description_default: "Descripcion larga",
	translations: JSON.stringify({
		en: { title: "Title", summary: "Summary" },
	}),
};

describe("GET /api/projects resuelve el idioma desde la misma fila", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("usa la traduccion y cae al default campo por campo", async () => {
		setFakeDbResult([project]);
		const res = await app.request("/api/projects?currentLocale=en", authed());
		const [row] = (await res.json()).data.rows;
		expect(row.title).toBe("Title");
		expect(row.summary).toBe("Summary");
		// La descripcion larga no esta traducida: cae al default.
		expect(row.description).toBe("Descripcion larga");
		expect(row.gallery).toEqual(["projects/a.webp"]);
		expect(row.images_topics).toEqual(["react"]);
		expect(row.featured).toBe(true);
	});

	it("un idioma sin traduccion devuelve todo en el default", async () => {
		setFakeDbResult([project]);
		const res = await app.request("/api/projects?currentLocale=fr", authed());
		const [row] = (await res.json()).data.rows;
		expect(row.title).toBe("Titulo");
		expect(row.summary).toBe("Resumen");
	});

	it("no expone campos internos (estado, traducciones crudas)", async () => {
		setFakeDbResult([project]);
		const res = await app.request("/api/projects?currentLocale=es", authed());
		const [row] = (await res.json()).data.rows;
		expect(row.translations).toBeUndefined();
		expect(row.status).toBeUndefined();
	});
});

describe("POST /api/contact-messages: mensaje opcional", () => {
	afterEach(() => {
		setFakeDbResult([]);
		resetFakeDbCalls();
	});

	it("201 sin more_information (el formulario lo marca opcional)", async () => {
		setFakeDbResult([{ message_id: 1 }]);
		const res = await app.request(
			"/api/contact-messages",
			authed({
				method: "POST",
				headers: { "x-forwarded-for": "198.51.100.77" },
				body: JSON.stringify({
					name: "Ana",
					email: "ana@example.com",
					phone: "+52 55 1234 5678",
				}),
			}),
		);
		expect(res.status).toBe(201);
	});
});
