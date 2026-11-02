import { asc, eq, sql } from "drizzle-orm";
import type { ExperienceAdminInput, Lang } from "../interfaces/interfaces.js";
import type { Db } from "../lib/db.js";
import {
	parseJson,
	toTranslationMap,
	translationFor,
} from "../lib/translations.js";
import { experience } from "../schemas/experiences.js";

type ExperienceRow = typeof experience.$inferSelect;
type ExperienceTexts = {
	work: string;
	title: string;
	subtitle: string;
	time: string;
	location: string;
};

const toPublic = (row: ExperienceRow, locale: string) => {
	const t = translationFor<ExperienceTexts>(row.translations, locale);
	return {
		experience_id: row.experience_id,
		work: t.work ?? row.work_default ?? null,
		title: t.title ?? row.title_default,
		description: t.subtitle ?? row.subtitle_default,
		img: row.img,
		alt: row.alt,
		time: t.time ?? row.time_default,
		location: t.location ?? row.location_default,
	};
};

const toAdmin = (row: ExperienceRow) => ({
	...row,
	translations: parseJson<Record<string, Partial<ExperienceTexts>>>(
		row.translations,
		{},
	),
});

const asColumns = ({ translations, ...rest }: ExperienceAdminInput) => ({
	...rest,
	translations: JSON.stringify(toTranslationMap(translations)),
});

export async function GetAllExperiences(db: Db, { currentLocale }: Lang) {
	const rows = await db
		.select()
		.from(experience)
		.orderBy(asc(experience.sort_order), asc(experience.experience_id));
	return rows.map((r) => toPublic(r, currentLocale));
}

export async function GetAllExperiencesAdmin(db: Db) {
	const rows = await db
		.select()
		.from(experience)
		.orderBy(asc(experience.sort_order), asc(experience.experience_id));
	return rows.map(toAdmin);
}

export async function CreateExperience(db: Db, input: ExperienceAdminInput) {
	const [created] = await db
		.insert(experience)
		.values(asColumns(input))
		.returning();
	return toAdmin(created);
}

export async function UpdateExperience(
	db: Db,
	experienceId: number,
	input: ExperienceAdminInput,
) {
	const [updated] = await db
		.update(experience)
		.set({ ...asColumns(input), updated_at: sql`current_timestamp` })
		.where(eq(experience.experience_id, experienceId))
		.returning();
	return updated ? toAdmin(updated) : null;
}

export async function DeleteExperience(db: Db, experienceId: number) {
	const [deleted] = await db
		.delete(experience)
		.where(eq(experience.experience_id, experienceId))
		.returning();
	return deleted ? toAdmin(deleted) : null;
}
