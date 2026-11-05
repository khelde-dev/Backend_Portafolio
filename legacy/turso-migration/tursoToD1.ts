/**
 * Convierte un respaldo de Turso (un JSON por tabla, formato de
 * backups/turso/<fecha>/) al esquema nuevo de D1 y genera un .sql para
 * `wrangler d1 execute`. Las traducciones, que vivian en tablas aparte, pasan
 * a la columna JSON `translations` de la misma fila.
 *
 * Funcion pura (sin tocar disco ni red) para poder probarla: la parte de
 * leer/escribir archivos esta en scripts/build-d1-import.ts.
 */

type Row = Record<string, unknown>;

export interface TursoBackup {
	projects?: Row[];
	project_translations?: Row[];
	experience?: Row[];
	experience_translations?: Row[];
	skills?: Row[];
	skill_translations?: Row[];
	education?: Row[];
	education_translations?: Row[];
	about?: Row[];
	about_translations?: Row[];
	comments?: Row[];
	contact_messages?: Row[];
}

const sqlValue = (value: unknown): string => {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number")
		return Number.isFinite(value) ? String(value) : "NULL";
	if (typeof value === "boolean") return value ? "1" : "0";
	return `'${String(value).replace(/'/g, "''")}'`;
};

const insert = (table: string, row: Row): string => {
	const columns = Object.keys(row);
	return `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES (${columns.map((c) => sqlValue(row[c])).join(", ")});`;
};

/** Agrupa las filas de una tabla de traducciones: { [id]: { [locale]: campos } } */
const groupTranslations = (
	rows: Row[] = [],
	idKey: string,
	pick: (row: Row) => Row,
): Map<unknown, Record<string, Row>> => {
	const map = new Map<unknown, Record<string, Row>>();
	for (const row of rows) {
		const id = row[idKey];
		const entry = map.get(id) ?? {};
		entry[String(row.locale)] = pick(row);
		map.set(id, entry);
	}
	return map;
};

const json = (value: unknown): string => JSON.stringify(value ?? {});

export const buildImportSql = (backup: TursoBackup): string => {
	const out: string[] = [
		"-- Generado por scripts/tursoToD1.ts. Aplicar SOBRE una base recien migrada.",
	];

	const projectTr = groupTranslations(
		backup.project_translations,
		"project_id",
		(r) => ({
			title: r.title,
			// El texto viejo era uno solo: alimenta el resumen y la descripcion larga.
			summary: r.description,
			description: r.description,
		}),
	);
	for (const p of backup.projects ?? []) {
		out.push(
			insert("projects", {
				id: p.id,
				slug: p.slug,
				category: p.category,
				status: "published",
				card_image: p.card_image,
				images_topics: p.images_topics ?? "[]",
				link_repo: p.link_repo ?? null,
				link_web: p.link_web ?? null,
				fork: p.fork ? 1 : 0,
				title_default: p.title_default,
				summary_default: p.description_default,
				description_default: p.description_default,
				translations: json(projectTr.get(p.id)),
			}),
		);
	}

	const experienceTr = groupTranslations(
		backup.experience_translations,
		"experience_id",
		(r) => ({
			work: r.work,
			title: r.title,
			subtitle: r.subtitle,
			time: r.time,
			location: r.location,
		}),
	);
	for (const e of backup.experience ?? []) {
		out.push(
			insert("experience", {
				id: e.id,
				work_default: e.work_default ?? null,
				title_default: e.title_default,
				subtitle_default: e.subtitle_default,
				img: e.img,
				alt: e.alt,
				time_default: e.time_default,
				location_default: e.location_default,
				translations: json(experienceTr.get(e.id)),
			}),
		);
	}

	const skillTr = groupTranslations(
		backup.skill_translations,
		"skill_id",
		(r) => ({ title: r.title }),
	);
	for (const s of backup.skills ?? []) {
		out.push(
			insert("skills", {
				id: s.id,
				title_default: s.title_default,
				images_topics: s.images_topics ?? "[]",
				translations: json(skillTr.get(s.id)),
			}),
		);
	}

	const educationTr = groupTranslations(
		backup.education_translations,
		"education_id",
		(r) => ({
			institution: r.institution,
			subtitle: r.subtitle,
			description: r.description,
			period: r.period,
		}),
	);
	for (const e of backup.education ?? []) {
		out.push(
			insert("education", {
				id: e.id,
				institution_default: e.institution_default,
				subtitle_default: e.subtitle_default,
				description_default: e.description_default,
				image: e.image,
				period_default: e.period_default,
				translations: json(educationTr.get(e.id)),
			}),
		);
	}

	const aboutTr = groupTranslations(
		backup.about_translations,
		"about_id",
		(r) => ({
			title_card: r.title_card,
			subtitle: r.subtitle,
			description: r.description,
		}),
	);
	for (const a of backup.about ?? []) {
		out.push(
			insert("about", {
				id: a.id,
				image: a.image,
				title_card_default: a.title_card_default,
				subtitle_default: a.subtitle_default,
				description_default: a.description_default,
				translations: json(aboutTr.get(a.id)),
			}),
		);
	}

	for (const c of backup.comments ?? []) {
		out.push(
			insert("comments", {
				id: c.id ?? c.comment_id,
				name: c.name,
				job: c.job ?? null,
				description: c.description,
				direction: c.direction,
				country_flag: c.country_flag,
				country: c.country ?? "",
				status: c.status ?? "published",
				created_at: c.created_at,
				updated_at: c.created_at,
			}),
		);
	}

	for (const m of backup.contact_messages ?? []) {
		out.push(
			insert("contact_messages", {
				id: m.id ?? m.message_id,
				name: m.name,
				email: m.email,
				phone: m.phone,
				more_information: m.more_information ?? null,
				status: m.status ?? "unread",
				created_at: m.created_at,
				updated_at: m.created_at,
			}),
		);
	}

	return `${out.join("\n")}\n`;
};
