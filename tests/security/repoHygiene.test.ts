import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Higiene del repositorio: lo que jamas debe commitearse. Complementa al
 * escaner de secretos del CI (gitleaks), con reglas especificas de este
 * proyecto, y falla rapido en local.
 */
const ROOT = join(import.meta.dir, "../..");

const walk = (dir: string, out: string[] = []): string[] => {
	for (const name of readdirSync(dir)) {
		if (
			[
				"node_modules",
				".git",
				".wrangler",
				"backups",
				"coverage",
				"dist",
			].includes(name)
		)
			continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else out.push(path);
	}
	return out;
};

const files = walk(ROOT);
const text = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(ROOT.length + 1).replaceAll("\\", "/");

describe("secretos", () => {
	const SECRET_PATTERNS: [string, RegExp][] = [
		["clave privada PEM", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
		[
			"token de Cloudflare/GitHub/AWS",
			/\b(?:ghp_|gho_|github_pat_|AKIA)[A-Za-z0-9_]{16,}/,
		],
		[
			"JWT embebido",
			/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
		],
		["token de libsql/Turso", /libsql:\/\/[^\s"']*authToken=/i],
	];

	const scanned = files.filter(
		(f) =>
			/\.(ts|tsx|js|mjs|json|jsonc|toml|md|yml|yaml|sql)$/.test(f) &&
			!rel(f).startsWith("tests/") &&
			!rel(f).endsWith("bun.lock"),
	);

	for (const [name, pattern] of SECRET_PATTERNS) {
		it(`el codigo y la config no contienen ${name}`, () => {
			const hits = scanned.filter((f) => pattern.test(text(f))).map(rel);
			expect(hits).toEqual([]);
		});
	}

	it("wrangler.jsonc no guarda secretos en `vars`", () => {
		const config = text(join(ROOT, "wrangler.jsonc"));
		const vars = /"vars"\s*:\s*\{([\s\S]*?)\n\t\}/.exec(config)?.[1] ?? "";
		const names = [...vars.matchAll(/"([A-Z_]+)"\s*:/g)].map((m) => m[1]);
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) {
			expect(name).not.toMatch(/SECRET|PASSWORD|PRIVATE|^API_TOKEN$|_KEY$/);
		}
	});

	it(".gitignore cubre .env, .dev.vars, backups y el estado de wrangler", () => {
		const ignore = text(join(ROOT, ".gitignore"));
		for (const entry of [".env", ".dev.vars", "backups/", ".wrangler/"]) {
			expect(ignore).toContain(entry);
		}
	});

	it("no hay archivos .env ni .dev.vars rastreables fuera de las plantillas", () => {
		const risky = files
			.map(rel)
			.filter((f) => /(^|\/)\.(env|dev\.vars)(\..+)?$/.test(f))
			.filter((f) => !/\.(example|sample|template)$/.test(f));
		// Existen en la maquina del desarrollador pero estan en .gitignore: aqui
		// solo se exige que cualquiera que exista este ignorado.
		const ignore = text(join(ROOT, ".gitignore"));
		for (const f of risky) {
			const base = f.split("/").pop() ?? f;
			const covered = ignore
				.split("\n")
				.some((line) => line.trim() === base || line.trim() === `${base}*`);
			expect(covered || /^\.env\./.test(base)).toBe(true);
		}
	});
});

describe("superficie de ataque", () => {
	it("no hay codigo que evalue texto dinamico", () => {
		const hits = files
			.map(rel)
			.filter((f) => f.startsWith("src/") && /\.(ts|tsx)$/.test(f))
			.filter((f) => /\beval\s*\(|new Function\s*\(/.test(text(join(ROOT, f))));
		expect(hits).toEqual([]);
	});

	it("no se arma SQL concatenando texto en el codigo de la API", () => {
		const hits = files
			.map(rel)
			.filter((f) => f.startsWith("src/") && f.endsWith(".ts"))
			.filter((f) =>
				/sql\.raw\s*\(|\.prepare\(\s*`[^`]*\$\{/.test(text(join(ROOT, f))),
			);
		expect(hits).toEqual([]);
	});

	it("el Worker no declara cron, colas ni Durable Objects (sin costos ocultos)", () => {
		const config = text(join(ROOT, "wrangler.jsonc"));
		for (const key of [
			"crons",
			"queues",
			"durable_objects",
			"workflows",
			"triggers",
		]) {
			expect(config).not.toMatch(new RegExp(`"${key}"\\s*:`));
		}
		expect(text(join(ROOT, "src/index.ts"))).not.toMatch(/scheduled|queue\(/);
	});

	it("la unica forma de autenticar el CMS es Cloudflare Access (sin contrasenas)", () => {
		const src = files.map(rel).filter((f) => f.startsWith("src/"));
		const joined = src.map((f) => text(join(ROOT, f))).join("\n");
		expect(joined).not.toMatch(/Bun\.password|argon2|bcrypt|ADMIN_JWT_SECRET/i);
	});
});
