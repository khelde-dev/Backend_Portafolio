import { asc, eq, sql } from "drizzle-orm";
import type { EducationAdminInput, Lang } from "../interfaces/interfaces.js";
import type { Db } from "../lib/db.js";
import {
	parseJson,
	toTranslationMap,
	translationFor,
} from "../lib/translations.js";
import { education } from "../schemas/education.js";

type EducationRow = typeof education.$inferSelect;
type EducationTexts = {
	institution: string;
	subtitle: string;
	description: string;
	period: string;
};

const toPublic = (row: EducationRow, locale: string) => {
	const t = translationFor<EducationTexts>(row.translations, locale);
	return {
		education_id: row.education_id,
		institution: t.institution ?? row.institution_default,
		subtitle: t.subtitle ?? row.subtitle_default,
		description: t.description ?? row.description_default,
		image: row.image,
		period: t.period ?? row.period_default,
	};
};

const toAdmin = (row: EducationRow) => ({
	...row,
	translations: parseJson<Record<string, Partial<EducationTexts>>>(
		row.translations,
		{},
	),
});

const asColumns = ({ translations, ...rest }: EducationAdminInput) => ({
	...rest,
	translations: JSON.stringify(toTranslationMap(translations)),
});

export async function GetAllEducation(db: Db, { currentLocale }: Lang) {
	const rows = await db
		.select()
		.from(education)
		.orderBy(asc(education.sort_order), asc(education.education_id));
	return rows.map((r) => toPublic(r, currentLocale));
}

export async function GetAllEducationAdmin(db: Db) {
	const rows = await db
		.select()
		.from(education)
		.orderBy(asc(education.sort_order), asc(education.education_id));
	return rows.map(toAdmin);
}

export async function CreateEducation(db: Db, input: EducationAdminInput) {
	const [created] = await db
		.insert(education)
		.values(asColumns(input))
		.returning();
	return toAdmin(created);
}

export async function UpdateEducation(
	db: Db,
	educationId: number,
	input: EducationAdminInput,
) {
	const [updated] = await db
		.update(education)
		.set({ ...asColumns(input), updated_at: sql`current_timestamp` })
		.where(eq(education.education_id, educationId))
		.returning();
	return updated ? toAdmin(updated) : null;
}

export async function DeleteEducation(db: Db, educationId: number) {
	const [deleted] = await db
		.delete(education)
		.where(eq(education.education_id, educationId))
		.returning();
	return deleted ? toAdmin(deleted) : null;
}
