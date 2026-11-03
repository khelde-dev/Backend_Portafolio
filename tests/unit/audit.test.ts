import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { auditLog, toSummary } from "../../src/lib/auditLog.js";
import {
	fakeDb,
	resetFakeDbCalls,
	setFakeDbError,
	setFakeDbResult,
} from "../support/fakeDb.js";
import { adminAuthed, app } from "../support/helpers.js";

afterEach(() => {
	setFakeDbError(null);
	setFakeDbResult([]);
	resetFakeDbCalls();
});

describe("toSummary", () => {
	it("una sola linea, sin espacios de mas", () => {
		expect(toSummary("  Mi\n  proyecto  ")).toBe("Mi proyecto");
	});

	it("corta lo largo y no devuelve nada para lo que no es texto", () => {
		const long = toSummary("x".repeat(500));
		expect(long?.length).toBe(120);
		expect(long?.endsWith("…")).toBe(true);
		expect(toSummary("")).toBeNull();
		expect(toSummary(undefined)).toBeNull();
		expect(toSummary({ title: "x" })).toBeNull();
	});
});

describe("auditLog", () => {
	const params = () => ({
		// biome-ignore lint/suspicious/noExplicitAny: doble de db para pruebas
		db: fakeDb as any,
		adminEmail: "yo@example.com",
		action: "update" as const,
		resource: "projects",
		resourceId: 3,
		summary: "Mi proyecto",
	});

	it("escribe en consola y en la base", async () => {
		const log = spyOn(console, "log").mockImplementation(() => {});
		await auditLog(params());
		expect(log.mock.calls[0][0]).toContain("yo@example.com update projects/3");
		log.mockRestore();
	});

	it("si guardar el historial falla, no lanza: la escritura ya ocurrio", async () => {
		const log = spyOn(console, "log").mockImplementation(() => {});
		const err = spyOn(console, "error").mockImplementation(() => {});
		setFakeDbError(new Error("D1 caida, con datos internos"));
		await expect(auditLog(params())).resolves.toBeUndefined();
		// Mensaje fijo: ni el error crudo ni los datos de la peticion.
		expect(err.mock.calls[0]).toEqual([
			"[AUDIT] no se pudo guardar el historial",
		]);
		log.mockRestore();
		err.mockRestore();
	});
});

describe("GET /api/audit", () => {
	it("200 con la lista", async () => {
		setFakeDbResult([
			{
				id: 2,
				at: "2026-01-01 00:00:00",
				admin_email: "yo@example.com",
				action: "update",
				resource: "projects",
				resource_id: "3",
				summary: "Mi proyecto",
			},
		]);
		const res = await app.request("/api/audit", await adminAuthed());
		expect(res.status).toBe(200);
		expect((await res.json()).data).toHaveLength(1);
	});

	it("400 con un limit fuera de rango", async () => {
		for (const limit of ["0", "1001", "abc", "-5"]) {
			const res = await app.request(
				`/api/audit?limit=${limit}`,
				await adminAuthed(),
			);
			expect(res.status).toBe(400);
		}
	});

	it("acepta el limite maximo", async () => {
		const res = await app.request("/api/audit?limit=1000", await adminAuthed());
		expect(res.status).toBe(200);
	});
});
