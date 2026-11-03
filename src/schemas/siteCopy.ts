import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { LOCALES } from "../lib/constants.js";
import { hasDuplicateLocales } from "../lib/translations.js";
import { r2Key } from "../lib/validators.js";
import { timestamps, translationsColumn } from "./common.js";

/**
 * Textos del sitio que son contenido y no interfaz: la etiqueta y la
 * presentacion del hero, la frase del manifiesto y la descripcion para buscadores.
 * Singleton (siempre id = 1), con la misma forma que `about`: valores en espanol y
 * `translations` con el resto de idiomas. Lo que falte en un idioma cae al espanol.
 */
export const siteCopy = sqliteTable("site_copy", {
	site_copy_id: int("id").primaryKey().notNull(),
	/** Clave en R2 de la foto del hero (se sube desde el CMS, siempre WebP). */
	hero_image: text("hero_image").notNull(),
	hero_image_alt_default: text("hero_image_alt_default").notNull(),
	hero_label_default: text("hero_label_default").notNull(),
	hero_lead_default: text("hero_lead_default").notNull(),
	manifesto_text_default: text("manifesto_text_default").notNull(),
	meta_description_default: text("meta_description_default").notNull(),
	translations: translationsColumn(),
	...timestamps,
});

export const SITE_COPY_LIMITS = {
	hero_label: 100,
	hero_image_alt: 160,
	hero_lead: 500,
	manifesto_text: 500,
	meta_description: 300,
} as const;

const optionalText = (max: number) =>
	z.string().trim().min(1).max(max).optional();

const siteCopyTranslationInputSchema = z.object({
	locale: z.enum(LOCALES),
	hero_label: optionalText(SITE_COPY_LIMITS.hero_label),
	hero_image_alt: optionalText(SITE_COPY_LIMITS.hero_image_alt),
	hero_lead: optionalText(SITE_COPY_LIMITS.hero_lead),
	manifesto_text: optionalText(SITE_COPY_LIMITS.manifesto_text),
	meta_description: optionalText(SITE_COPY_LIMITS.meta_description),
});

const required = (label: string, max: number) =>
	z
		.string()
		.trim()
		.min(1, `${label} es requerido`)
		.max(max, `${label} admite hasta ${max} caracteres`);

export const siteCopyAdminInputSchema = z.object({
	// El `updated_at` que leyo el formulario: si la fila ya cambio, el PUT da 409.
	updated_at: z.string().max(40).optional(),
	hero_image: r2Key("La foto del hero"),
	hero_image_alt_default: required(
		"El texto alternativo de la foto",
		SITE_COPY_LIMITS.hero_image_alt,
	),
	hero_label_default: required(
		"La etiqueta del hero",
		SITE_COPY_LIMITS.hero_label,
	),
	hero_lead_default: required(
		"La presentacion del hero",
		SITE_COPY_LIMITS.hero_lead,
	),
	manifesto_text_default: required(
		"La frase del manifiesto",
		SITE_COPY_LIMITS.manifesto_text,
	),
	meta_description_default: required(
		"La descripcion del sitio",
		SITE_COPY_LIMITS.meta_description,
	),
	translations: z
		.array(siteCopyTranslationInputSchema)
		.default([])
		.refine((list) => !hasDuplicateLocales(list), "Idioma repetido"),
});

export type SiteCopyAdminInput = z.infer<typeof siteCopyAdminInputSchema>;
