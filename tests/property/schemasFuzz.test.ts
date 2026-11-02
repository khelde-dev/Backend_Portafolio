import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { insertCommentsSchema } from "../../src/schemas/comments.js";
import { contactMessageUserInputSchema } from "../../src/schemas/contactMessages.js";
import { projectAdminInputSchema } from "../../src/schemas/projects.js";

/**
 * Fuzzing de los esquemas de entrada: ningun valor, por raro que sea, puede
 * hacer que la validacion lance una excepcion (seria un 500 explotable) ni
 * dejar pasar un objeto con claves que el esquema no declara.
 */
const NUM_RUNS = { numRuns: 500 };

const schemas = {
	proyecto: projectAdminInputSchema,
	contacto: contactMessageUserInputSchema,
	comentario: insertCommentsSchema.omit({ status: true }),
};

describe("la validacion nunca lanza", () => {
	for (const [name, schema] of Object.entries(schemas)) {
		it(`${name}: con cualquier valor`, () => {
			fc.assert(
				fc.property(
					fc.anything({ withNullPrototype: true, withBigInt: true }),
					(value) => {
						expect(() => schema.safeParse(value)).not.toThrow();
					},
				),
				NUM_RUNS,
			);
		});

		it(`${name}: con objetos de claves arbitrarias`, () => {
			fc.assert(
				fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (value) => {
					expect(() => schema.safeParse(value)).not.toThrow();
				}),
				NUM_RUNS,
			);
		});
	}
});

describe("la salida solo contiene claves declaradas", () => {
	const validProject = {
		slug: "ok",
		category: "frontend",
		card_image: "/a.webp",
		title_default: "t",
		summary_default: "s",
		description_default: "d",
	};

	it("proyecto: claves extra (incluida __proto__) no sobreviven", () => {
		fc.assert(
			fc.property(
				fc.dictionary(
					fc.oneof(
						fc.string(),
						fc.constantFrom("__proto__", "constructor", "prototype", "isAdmin"),
					),
					fc.jsonValue(),
				),
				(extra) => {
					const parsed = projectAdminInputSchema.safeParse({
						...validProject,
						...extra,
						...validProject,
					});
					if (!parsed.success) return;
					const declared = Object.keys(projectAdminInputSchema.shape);
					for (const key of Object.keys(parsed.data)) {
						expect(declared).toContain(key);
					}
					expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
				},
			),
			NUM_RUNS,
		);
	});

	it("contacto: el cliente no puede colar status ni replied_at", () => {
		fc.assert(
			fc.property(
				fc.record({
					status: fc.string(),
					replied_at: fc.string(),
					message_id: fc.integer(),
				}),
				(extra) => {
					const parsed = contactMessageUserInputSchema.safeParse({
						name: "Ana",
						email: "ana@example.com",
						phone: "+52 55 1234 5678",
						...extra,
					});
					expect(parsed.success).toBe(true);
					if (parsed.success) {
						expect(Object.keys(parsed.data).sort()).toEqual(
							["email", "name", "phone"].sort(),
						);
					}
				},
			),
			NUM_RUNS,
		);
	});
});

describe("limites de tamano", () => {
	it("contacto: un nombre mas largo que 100 nunca es valido", () => {
		fc.assert(
			fc.property(fc.string({ minLength: 101, maxLength: 400 }), (name) => {
				const res = contactMessageUserInputSchema.safeParse({
					name,
					email: "ana@example.com",
					phone: "+52 55 1234 5678",
				});
				expect(res.success).toBe(false);
			}),
			NUM_RUNS,
		);
	});

	it("proyecto: un slug de mas de 100 caracteres nunca es valido", () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[a-z0-9]{101,300}$/), (slug) => {
				const res = projectAdminInputSchema.safeParse({
					slug,
					category: "frontend",
					card_image: "/a.webp",
					title_default: "t",
					summary_default: "s",
					description_default: "d",
				});
				expect(res.success).toBe(false);
			}),
			NUM_RUNS,
		);
	});
});
