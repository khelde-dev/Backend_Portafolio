import { asc, eq, sql } from "drizzle-orm";
import type { Lang, SkillAdminInput } from "../interfaces/interfaces.js";
import type { Db } from "../lib/db.js";
import {
	parseJson,
	toTranslationMap,
	translationFor,
} from "../lib/translations.js";
import { skills } from "../schemas/skills.js";

type SkillRow = typeof skills.$inferSelect;
type SkillTexts = { title: string };

const toPublic = (row: SkillRow, locale: string) => {
	const t = translationFor<SkillTexts>(row.translations, locale);
	return {
		skill_id: row.skill_id,
		title: t.title ?? row.title_default,
		images_topics: parseJson<string[]>(row.images_topics, []),
	};
};

const toAdmin = (row: SkillRow) => ({
	...row,
	images_topics: parseJson<string[]>(row.images_topics, []),
	translations: parseJson<Record<string, Partial<SkillTexts>>>(
		row.translations,
		{},
	),
});

const asColumns = ({
	translations,
	images_topics,
	...rest
}: SkillAdminInput) => ({
	...rest,
	images_topics: JSON.stringify(images_topics),
	translations: JSON.stringify(toTranslationMap(translations)),
});

export async function GetAllSkills(db: Db, { currentLocale }: Lang) {
	const rows = await db
		.select()
		.from(skills)
		.orderBy(asc(skills.sort_order), asc(skills.skill_id));
	return rows.map((r) => toPublic(r, currentLocale));
}

export async function GetAllSkillsAdmin(db: Db) {
	const rows = await db
		.select()
		.from(skills)
		.orderBy(asc(skills.sort_order), asc(skills.skill_id));
	return rows.map(toAdmin);
}

export async function CreateSkill(db: Db, input: SkillAdminInput) {
	const [created] = await db
		.insert(skills)
		.values(asColumns(input))
		.returning();
	return toAdmin(created);
}

export async function UpdateSkill(
	db: Db,
	skillId: number,
	input: SkillAdminInput,
) {
	const [updated] = await db
		.update(skills)
		.set({ ...asColumns(input), updated_at: sql`current_timestamp` })
		.where(eq(skills.skill_id, skillId))
		.returning();
	return updated ? toAdmin(updated) : null;
}

export async function DeleteSkill(db: Db, skillId: number) {
	const [deleted] = await db
		.delete(skills)
		.where(eq(skills.skill_id, skillId))
		.returning();
	return deleted ? toAdmin(deleted) : null;
}
