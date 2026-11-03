import { eq, sql } from "drizzle-orm";
import type { AboutAdminInput, Lang } from "../interfaces/interfaces.js";
import type { Db } from "../lib/db.js";
import { andWith, staleConflict, unchangedSince } from "../lib/optimistic.js";
import {
	parseJson,
	toTranslationMap,
	translationFor,
} from "../lib/translations.js";
import { about } from "../schemas/about.js";

// Singleton: siempre about_id = 1 (ver schemas/about.ts).
const ABOUT_ID = 1;

type AboutRow = typeof about.$inferSelect;
type AboutTexts = { title_card: string; subtitle: string; description: string };

const toAdmin = (row: AboutRow) => ({
	...row,
	translations: parseJson<Record<string, Partial<AboutTexts>>>(
		row.translations,
		{},
	),
});

export async function GetAbout(db: Db, { currentLocale }: Lang) {
	const [row] = await db
		.select()
		.from(about)
		.where(eq(about.about_id, ABOUT_ID));
	if (!row) return null;

	const t = translationFor<AboutTexts>(row.translations, currentLocale);
	return {
		about_id: row.about_id,
		image: row.image,
		title_card: t.title_card ?? row.title_card_default,
		subtitle: t.subtitle ?? row.subtitle_default,
		description: t.description ?? row.description_default,
	};
}

export async function GetAboutAdmin(db: Db) {
	const [row] = await db
		.select()
		.from(about)
		.where(eq(about.about_id, ABOUT_ID));
	return row ? toAdmin(row) : null;
}

// Un solo upsert: crea la fila la primera vez y la reemplaza despues.
export async function UpdateAbout(
	db: Db,
	input: AboutAdminInput,
	expected?: string,
) {
	const { translations, ...rest } = input;
	const values = {
		...rest,
		translations: JSON.stringify(toTranslationMap(translations)),
	};
	const [saved] = await db
		.insert(about)
		.values({ about_id: ABOUT_ID, ...values })
		.onConflictDoUpdate({
			target: about.about_id,
			set: { ...values, updated_at: sql`current_timestamp` },
			// Si la fila cambio desde que se leyo, no se pisa (ver lib/optimistic.ts).
			setWhere: unchangedSince(about.updated_at, expected),
		})
		.returning();
	if (!saved) throw staleConflict();
	return toAdmin(saved);
}
