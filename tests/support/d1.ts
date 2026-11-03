import { beforeAll, beforeEach } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { Bindings } from "../../src/env.js";
import { TEST_ENV } from "./helpers.js";

/**
 * Base D1 REAL para las pruebas de integracion: Miniflare en memoria (sin
 * persistir nada en disco ni tocar Cloudflare), con las migraciones de
 * `drizzle/` aplicadas tal cual se aplicarian en produccion.
 *
 * Estos tests NO usan el preload de `bunfig.toml` (el que sustituye `createDb`
 * por un doble): corren con `tests/integration/bunfig.toml`.
 */
const TABLES = [
	"about",
	"comments",
	"contact_info",
	"contact_messages",
	"education",
	"experience",
	"projects",
	"skills",
] as const;

const MIGRATIONS_DIR = join(import.meta.dir, "../../drizzle");

/** Sentencias de todas las migraciones, en orden, separadas por el marcador de drizzle. */
export const migrationStatements = (): string[] =>
	readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith(".sql"))
		.sort()
		.flatMap((f) =>
			readFileSync(join(MIGRATIONS_DIR, f), "utf8")
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean),
		);

export type RealD1 = {
	env: Bindings;
	db: D1Database;
};

// Una sola D1 por proceso de `bun test`: levantar y cerrar Miniflare en cada
// archivo hace que el segundo cierre se cuelgue. Las tablas se vacian antes de
// cada test, asi que los archivos no se contaminan entre si.
let shared: Promise<{ db: D1Database; media: R2Bucket }> | undefined;

const boot = async () => {
	const proxy = await getPlatformProxy<{ DB: D1Database; MEDIA: R2Bucket }>({
		configPath: "wrangler.jsonc",
		persist: false,
	});
	for (const sql of migrationStatements()) {
		await proxy.env.DB.prepare(sql).run();
	}
	return { db: proxy.env.DB, media: proxy.env.MEDIA };
};

/**
 * Registra los hooks que levantan la D1 local (una vez), aplican las
 * migraciones y vacian las tablas antes de cada test. Devuelve un objeto cuyos
 * campos se llenan en `beforeAll` (leelos dentro de los tests, no al definirlos).
 */
export const useRealD1 = (): RealD1 => {
	const ctx = {} as RealD1;

	beforeAll(async () => {
		if ((globalThis as { __DB_MOCKED__?: boolean }).__DB_MOCKED__) {
			throw new Error(
				"Estas pruebas necesitan la D1 real: corre `bun run test:integration`, no `bun test`.",
			);
		}
		shared ??= boot();
		const { db, media } = await shared;
		ctx.db = db;
		ctx.env = { ...TEST_ENV, DB: db, MEDIA: media };
	}, 60_000);

	beforeEach(async () => {
		await ctx.db.batch(TABLES.map((t) => ctx.db.prepare(`DELETE FROM ${t}`)));
	});

	return ctx;
};
