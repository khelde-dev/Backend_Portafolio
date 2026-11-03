import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { LOCALES } from "../lib/constants.js";
import { hasDuplicateLocales } from "../lib/translations.js";
import { r2Key } from "../lib/validators.js";
import { timestamps, translationsColumn } from "./common.js";

/** Singleton: siempre id = 1. */
export const about = sqliteTable("about", {
	about_id: int("id").primaryKey().notNull(),
	image: text("image").notNull(),
	title_card_default: text("title_card_default").notNull(),
	subtitle_default: text("subtitle_default").notNull(),
	description_default: text("description_default").notNull(),
	translations: translationsColumn(),
	...timestamps,
});

const aboutTranslationInputSchema = z.object({
	locale: z.enum(LOCALES),
	title_card: z.string().min(1).optional(),
	subtitle: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
});

export const aboutAdminInputSchema = z.object({
	// El `updated_at` que leyo el formulario: si la fila ya cambio, el PUT da 409.
	updated_at: z.string().max(40).optional(),
	image: r2Key(),
	title_card_default: z
		.string()
		.min(1, "El titulo de la tarjeta default es requerido"),
	subtitle_default: z.string().min(1, "El subtitulo default es requerido"),
	description_default: z.string().min(1, "La descripcion default es requerida"),
	translations: z
		.array(aboutTranslationInputSchema)
		.default([])
		.refine((list) => !hasDuplicateLocales(list), "Idioma repetido"),
});

export type AboutAdminInput = z.infer<typeof aboutAdminInputSchema>;
