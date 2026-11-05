/**
 * Uso:  bun run scripts/build-d1-import.ts backups/turso/<fecha> [salida.sql]
 *
 * Lee los JSON del respaldo de Turso y escribe un .sql listo para D1:
 *   bunx wrangler d1 execute portafolio-db --remote --file=<salida.sql>
 * (aplicar DESPUES de `bun run db:migrate:remote`). Por defecto escribe
 * backups/d1-import.sql, que esta fuera de git (contiene datos reales).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildImportSql, type TursoBackup } from "./tursoToD1.js";

const [dir, out = "backups/d1-import.sql"] = process.argv.slice(2);
if (!dir) {
	console.error(
		"Falta la carpeta del respaldo. Ej: backups/turso/2026-09-14T07-57-58-435Z",
	);
	process.exit(1);
}

const TABLES = [
	"projects",
	"project_translations",
	"experience",
	"experience_translations",
	"skills",
	"skill_translations",
	"education",
	"education_translations",
	"about",
	"about_translations",
	"comments",
	"contact_messages",
] as const;

const backup: TursoBackup = {};
const missing: string[] = [];
for (const table of TABLES) {
	const file = join(dir, `${table}.json`);
	if (existsSync(file)) backup[table] = JSON.parse(readFileSync(file, "utf8"));
	else missing.push(table);
}

writeFileSync(out, buildImportSql(backup));
console.log(`Escrito ${out}`);
if (missing.length) {
	console.warn(
		`Sin datos en el respaldo para: ${missing.join(", ")} (quedaran vacias).`,
	);
}
