import { describe, expect, it } from "bun:test";
import { isUniqueViolation } from "../src/lib/dbErrors.js";

describe("isUniqueViolation", () => {
	it("reconoce el error directo del driver", () => {
		expect(
			isUniqueViolation(new Error("UNIQUE constraint failed: projects.slug")),
		).toBe(true);
	});

	it("lo encuentra aunque Drizzle y D1 lo envuelvan en 'cause'", () => {
		const driver = new Error("UNIQUE constraint failed: projects.slug");
		const d1 = new Error("D1_ERROR", { cause: driver });
		const drizzle = new Error("Failed query: insert into projects", {
			cause: d1,
		});
		expect(isUniqueViolation(drizzle)).toBe(true);
	});

	it("ignora otros errores y valores que no son Error", () => {
		expect(isUniqueViolation(new Error("NOT NULL constraint failed"))).toBe(
			false,
		);
		expect(isUniqueViolation("UNIQUE constraint failed")).toBe(false);
		expect(isUniqueViolation(undefined)).toBe(false);
	});
});
