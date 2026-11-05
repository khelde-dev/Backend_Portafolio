import { eq, sql } from "drizzle-orm";
import type { Lang } from "../interfaces/interfaces.js";
import type { Db } from "../lib/db.js";
import { staleConflict, unchangedSince } from "../lib/optimistic.js";
import {
	parseJson,
	toTranslationMap,
	translationFor,
} from "../lib/translations.js";
import { type SiteCopyAdminInput, siteCopy } from "../schemas/siteCopy.js";

// Singleton: siempre site_copy_id = 1 (ver schemas/siteCopy.ts).
const SITE_COPY_ID = 1;

type SiteCopyRow = typeof siteCopy.$inferSelect;
type SiteCopyTexts = {
	hero_image_alt: string;
	hero_label: string;
	hero_lead: string;
	manifesto_text: string;
	meta_description: string;
};

const toAdmin = (row: SiteCopyRow) => ({
	...row,
	translations: parseJson<Record<string, Partial<SiteCopyTexts>>>(
		row.translations,
		{},
	),
});

const readRow = async (db: Db) => {
	const [row] = await db
		.select()
		.from(siteCopy)
		.where(eq(siteCopy.site_copy_id, SITE_COPY_ID));
	return row ?? null;
};

/** Lo que ve el sitio, ya en el idioma pedido (lo que falte cae al espanol). */
export async function GetSiteCopy(db: Db, { currentLocale }: Lang) {
	const row = await readRow(db);
	if (!row) return null;
	const t = translationFor<SiteCopyTexts>(row.translations, currentLocale);
	return {
		hero_image: row.hero_image,
		hero_image_alt: t.hero_image_alt ?? row.hero_image_alt_default,
		hero_label: t.hero_label ?? row.hero_label_default,
		hero_lead: t.hero_lead ?? row.hero_lead_default,
		manifesto_text: t.manifesto_text ?? row.manifesto_text_default,
		meta_description: t.meta_description ?? row.meta_description_default,
		// Clave en R2 del PDF; el sitio la convierte en URL con su `PUBLIC_MEDIA_URL`.
		cv_pdf: row.cv_pdf_key,
	};
}

export async function GetSiteCopyAdmin(db: Db) {
	const row = await readRow(db);
	return row ? toAdmin(row) : null;
}

// Un solo upsert: crea la fila la primera vez y la reemplaza despues.
export async function UpdateSiteCopy(
	db: Db,
	input: Omit<SiteCopyAdminInput, "updated_at">,
	expected?: string,
) {
	const { translations, ...rest } = input;
	const values = {
		...rest,
		translations: JSON.stringify(toTranslationMap(translations)),
	};
	const [saved] = await db
		.insert(siteCopy)
		.values({ site_copy_id: SITE_COPY_ID, ...values })
		.onConflictDoUpdate({
			target: siteCopy.site_copy_id,
			set: { ...values, updated_at: sql`current_timestamp` },
			// Si la fila cambio desde que se leyo, no se pisa (ver lib/optimistic.ts).
			setWhere: unchangedSince(siteCopy.updated_at, expected),
		})
		.returning();
	if (!saved) throw staleConflict();
	return toAdmin(saved);
}
