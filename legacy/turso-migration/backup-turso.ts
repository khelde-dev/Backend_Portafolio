import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

/**
 * Backup completo de la Turso real, tabla por tabla, a JSON local - antes
 * de tocar cualquier esquema (docs/04-migracion-datos.md, repo
 * Portafolio, lo exige explicito antes de la Fase 2). No hardcodea la
 * lista de tablas: la descubre via sqlite_master, para no depender de que
 * el schema de Drizzle en este repo ya refleje el 100% de lo que existe
 * en la base real (ver la pregunta abierta en ese doc sobre
 * experience_translations).
 *
 * Uso: `bun run backup:turso`
 *
 * Los backups NUNCA se commitean (contienen PII real: nombres/emails de
 * comentarios/contacto) - la carpeta de salida esta en .gitignore.
 */

const databaseUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!databaseUrl) {
	throw new Error("TURSO_DATABASE_URL environment variable is not set.");
}
if (!authToken) {
	throw new Error("TURSO_AUTH_TOKEN environment variable is not set.");
}

const client = createClient({ url: databaseUrl, authToken });

// Tablas internas de sqlite/drizzle que no son datos de la app - se
// excluyen del backup de contenido (drizzle_migrations se lista aparte,
// informativo, no es "dato de negocio").
const INTERNAL_TABLES = new Set(["sqlite_sequence"]);

async function listTables(): Promise<string[]> {
	const result = await client.execute(
		"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
	);
	return result.rows
		.map((row) => String(row.name))
		.filter(
			(name) => !name.startsWith("sqlite_") && !INTERNAL_TABLES.has(name),
		);
}

async function dumpTable(table: string): Promise<unknown[]> {
	// Nombre de tabla viene de sqlite_master (no de input externo) - seguro
	// interpolarlo directo, no hay forma de que un usuario lo controle.
	const result = await client.execute(`SELECT * FROM "${table}"`);
	return result.rows.map((row) => ({ ...row }));
}

async function main() {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outDir = path.join(process.cwd(), "backups", "turso", timestamp);
	fs.mkdirSync(outDir, { recursive: true });

	const tables = await listTables();
	console.log(`Tablas encontradas (${tables.length}): ${tables.join(", ")}`);

	const summary: Record<string, number> = {};

	for (const table of tables) {
		const rows = await dumpTable(table);
		const filePath = path.join(outDir, `${table}.json`);
		fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf-8");
		summary[table] = rows.length;
		console.log(`  ${table}: ${rows.length} filas -> ${filePath}`);
	}

	const summaryPath = path.join(outDir, "_summary.json");
	fs.writeFileSync(
		summaryPath,
		JSON.stringify({ timestamp, tables: summary }, null, 2),
		"utf-8",
	);

	console.log(`\nBackup completo en: ${outDir}`);
	client.close();
}

main().catch((err) => {
	console.error("Backup fallo:", err);
	process.exit(1);
});
