import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { HTTPException } from "hono/http-exception";
import { parseId } from "../../src/lib/parseId.js";
import {
	hasDuplicateLocales,
	parseJson,
	toTranslationMap,
	translationFor,
} from "../../src/lib/translations.js";
import { httpUrl, r2Key } from "../../src/lib/validators.js";

/**
 * Propiedades: en vez de elegir a mano unos cuantos ejemplos, fast-check
 * genera cientos de entradas (incluidas las raras) y comprueba lo que SIEMPRE
 * debe cumplirse.
 */
const RUNS = { numRuns: 300 };

describe("parseId", () => {
	it("todo entero positivo seguro en decimal se acepta y vuelve igual", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 999_999_999_999_999 }), (n) => {
				expect(parseId(String(n))).toBe(n);
			}),
			RUNS,
		);
	});

	it("cualquier otro texto se rechaza con 400 (nunca otro tipo de error)", () => {
		fc.assert(
			fc.property(
				fc.string().filter((s) => !/^[1-9][0-9]{0,14}$/.test(s)),
				(s) => {
					try {
						parseId(s);
						throw new Error(`acepto ${JSON.stringify(s)}`);
					} catch (err) {
						expect(err).toBeInstanceOf(HTTPException);
						expect((err as HTTPException).status).toBe(400);
					}
				},
			),
			RUNS,
		);
	});

	it("el resultado es siempre un entero seguro mayor que cero", () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[1-9][0-9]{0,14}$/), (s) => {
				const id = parseId(s);
				expect(Number.isSafeInteger(id)).toBe(true);
				expect(id).toBeGreaterThan(0);
			}),
			RUNS,
		);
	});
});

describe("parseJson", () => {
	it("nunca lanza, con cualquier valor", () => {
		fc.assert(
			fc.property(fc.anything(), fc.anything(), (raw, fallback) => {
				expect(() => parseJson(raw, fallback)).not.toThrow();
			}),
			RUNS,
		);
	});

	it("un JSON valido vuelve igual que se serializo", () => {
		fc.assert(
			fc.property(fc.jsonValue(), (value) => {
				// JSON no distingue -0 de 0: se compara contra el viaje de ida y vuelta.
				const text = JSON.stringify(value);
				expect(parseJson<unknown>(text, "fallback")).toEqual(JSON.parse(text));
			}),
			RUNS,
		);
	});

	it("un texto que no es JSON devuelve el valor por defecto", () => {
		fc.assert(
			fc.property(
				fc.string().filter((s) => {
					try {
						JSON.parse(s);
						return false;
					} catch {
						return true;
					}
				}),
				(s) => {
					expect(parseJson(s, "fallback")).toBe("fallback");
				},
			),
			RUNS,
		);
	});
});

describe("traducciones", () => {
	const locale = fc.constantFrom("es", "en", "fr");
	const fields = fc.record(
		{ title: fc.string(), summary: fc.string() },
		{ requiredKeys: [] },
	);

	it("toTranslationMap + translationFor devuelve lo que se guardo (sin vacios)", () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(fc.record({ locale }, { requiredKeys: ["locale"] }), {
					selector: (x) => x.locale,
				}),
				fields,
				(list, extra) => {
					const withFields = list.map((t) => ({ ...t, ...extra }));
					const raw = JSON.stringify(toTranslationMap(withFields));
					for (const { locale: l } of withFields) {
						const got = translationFor<Record<string, string>>(raw, l);
						for (const [k, v] of Object.entries(got)) {
							expect(v).not.toBe("");
							expect(v).toBe((extra as Record<string, string>)[k]);
						}
					}
				},
			),
			RUNS,
		);
	});

	it("translationFor nunca devuelve null, undefined ni cadenas vacias", () => {
		fc.assert(
			fc.property(fc.anything(), locale, (raw, l) => {
				const got = translationFor<Record<string, unknown>>(raw, l);
				for (const v of Object.values(got)) {
					expect(v === null || v === undefined || v === "").toBe(false);
				}
			}),
			RUNS,
		);
	});

	it("hasDuplicateLocales detecta repeticion exactamente cuando la hay", () => {
		fc.assert(
			fc.property(fc.array(locale, { maxLength: 6 }), (locales) => {
				const list = locales.map((l) => ({ locale: l }));
				expect(hasDuplicateLocales(list)).toBe(
					new Set(locales).size !== locales.length,
				);
			}),
			RUNS,
		);
	});
});

describe("httpUrl", () => {
	const schema = httpUrl();

	it("lo que acepta siempre empieza con http:// o https://", () => {
		fc.assert(
			fc.property(
				fc.oneof(fc.webUrl(), fc.string(), fc.constant("javascript:1")),
				(s) => {
					const parsed = schema.safeParse(s);
					if (parsed.success)
						expect(/^https?:\/\//i.test(parsed.data)).toBe(true);
				},
			),
			{ numRuns: 500 },
		);
	});

	it("rechaza cualquier esquema peligroso con cualquier mezcla de mayusculas", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("javascript", "data", "vbscript", "file", "blob"),
				fc.string({ maxLength: 20 }),
				fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
				(scheme, rest, flips) => {
					const mixed = [...scheme]
						.map((ch, i) => (flips[i % flips.length] ? ch.toUpperCase() : ch))
						.join("");
					expect(schema.safeParse(`${mixed}:${rest}`).success).toBe(false);
				},
			),
			RUNS,
		);
	});
});

describe("r2Key", () => {
	const schema = r2Key();

	it("lo que acepta jamas contiene .., esquema, barra invertida ni control", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 80 }), (s) => {
				if (!schema.safeParse(s).success) return;
				expect(s.split("/")).not.toContain("..");
				expect(s.startsWith("//")).toBe(false);
				expect(s.includes(":")).toBe(false);
				expect(s.includes(String.fromCharCode(92))).toBe(false);
				expect([...s].every((c) => c.charCodeAt(0) >= 0x20)).toBe(true);
			}),
			{ numRuns: 1000 },
		);
	});

	it("las claves normales siempre se aceptan", () => {
		fc.assert(
			fc.property(
				fc.stringMatching(
					/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(webp|png|jpg)$/,
				),
				(s) => {
					expect(schema.safeParse(s).success).toBe(true);
					expect(schema.safeParse(`/${s}`).success).toBe(true);
				},
			),
			RUNS,
		);
	});
});
