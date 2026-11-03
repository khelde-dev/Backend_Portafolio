import { asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Lang, ProjectAdminInput } from "../interfaces/interfaces.js";
import type { Db } from "../lib/db.js";
import { isUniqueViolation } from "../lib/dbErrors.js";
import { andWith, staleConflict, unchangedSince } from "../lib/optimistic.js";
import {
	parseJson,
	toTranslationMap,
	translationFor,
} from "../lib/translations.js";
import { projects } from "../schemas/projects.js";

type ProjectRow = typeof projects.$inferSelect;
type ProjectTexts = { title: string; summary: string; description: string };

// Lo que ve el sitio publico: el idioma pedido ya resuelto. `description`
// es el texto largo ("Sobre el proyecto"); la tarjeta usa `summary`.
const toPublic = (row: ProjectRow, locale: string) => {
	const t = translationFor<ProjectTexts>(row.translations, locale);
	return {
		project_id: row.project_id,
		slug: row.slug,
		category: row.category,
		card_image: row.card_image,
		gallery: parseJson<string[]>(row.gallery, []),
		video_url: row.video_url ?? null,
		images_topics: parseJson<string[]>(row.images_topics, []),
		link_repo: row.link_repo ?? null,
		link_web: row.link_web ?? null,
		fork: row.fork,
		featured: row.featured,
		title: t.title ?? row.title_default,
		summary: t.summary ?? row.summary_default,
		description: t.description ?? row.description_default,
	};
};

// Lo que ve el CMS: la fila completa, con el JSON ya parseado.
const toAdmin = (row: ProjectRow) => ({
	...row,
	gallery: parseJson<string[]>(row.gallery, []),
	images_topics: parseJson<string[]>(row.images_topics, []),
	translations: parseJson<Record<string, Partial<ProjectTexts>>>(
		row.translations,
		{},
	),
});

const asColumns = (input: ProjectAdminInput) => {
	const { translations, images_topics, gallery, ...rest } = input;
	return {
		...rest,
		images_topics: JSON.stringify(images_topics),
		gallery: JSON.stringify(gallery),
		translations: JSON.stringify(toTranslationMap(translations)),
	};
};

// Una escritura por recurso: D1 no tiene transacciones interactivas, y con
// las traducciones en la misma fila no hacen falta.
const rethrowConflict = (err: unknown): never => {
	if (isUniqueViolation(err)) {
		throw new HTTPException(409, {
			message: "Ya existe un proyecto con ese slug",
		});
	}
	throw err;
};

export async function GetAllProjects(db: Db, { currentLocale }: Lang) {
	const rows = await db
		.select()
		.from(projects)
		.where(eq(projects.status, "published"))
		.orderBy(asc(projects.sort_order), asc(projects.project_id));

	return { rows: rows.map((r) => toPublic(r, currentLocale)) };
}

// Para el CMS: incluye borradores y todas las traducciones.
export async function GetAllProjectsAdmin(db: Db) {
	const rows = await db
		.select()
		.from(projects)
		.orderBy(asc(projects.sort_order), asc(projects.project_id));
	return rows.map(toAdmin);
}

export async function CreateProject(db: Db, input: ProjectAdminInput) {
	try {
		const [created] = await db
			.insert(projects)
			.values(asColumns(input))
			.returning();
		return toAdmin(created);
	} catch (err) {
		return rethrowConflict(err);
	}
}

export async function UpdateProject(
	db: Db,
	projectId: number,
	input: ProjectAdminInput,
	expected?: string,
) {
	try {
		const [updated] = await db
			.update(projects)
			.set({ ...asColumns(input), updated_at: sql`current_timestamp` })
			.where(
				andWith(
					eq(projects.project_id, projectId),
					unchangedSince(projects.updated_at, expected),
				),
			)
			.returning();
		if (updated) return toAdmin(updated);
		// Sin fila: o ya no existe (404) o cambio desde que se leyo (409).
		if (expected) {
			const [still] = await db
				.select({ id: projects.project_id })
				.from(projects)
				.where(eq(projects.project_id, projectId));
			if (still) throw staleConflict();
		}
		return null;
	} catch (err) {
		return rethrowConflict(err);
	}
}

export async function DeleteProject(db: Db, projectId: number) {
	const [deleted] = await db
		.delete(projects)
		.where(eq(projects.project_id, projectId))
		.returning();
	return deleted ? toAdmin(deleted) : null;
}
