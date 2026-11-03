import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { LOCALES } from "../lib/constants.js";
import { hasDuplicateLocales } from "../lib/translations.js";
import { r2Key } from "../lib/validators.js";
import { timestamps, translationsColumn } from "./common.js";

export const education = sqliteTable("education", {
	education_id: int("id").primaryKey({ autoIncrement: true }).notNull(),
	sort_order: int("sort_order").notNull().default(0),
	institution_default: text("institution_default").notNull(),
	subtitle_default: text("subtitle_default").notNull(),
	description_default: text("description_default").notNull(),
	image: text("image").notNull(),
	period_default: text("period_default").notNull(),
	translations: translationsColumn(),
	...timestamps,
});

const educationTranslationInputSchema = z.object({
	locale: z.enum(LOCALES),
	institution: z.string().max(150).optional().nullable(),
	subtitle: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
	period: z.string().min(1).optional(),
});

export const educationAdminInputSchema = z.object({
	// El `updated_at` que leyo el formulario: si la fila ya cambio, el PUT da 409.
	updated_at: z.string().max(40).optional(),
	sort_order: z.number().int().default(0),
	institution_default: z.string().min(1, "La institucion default es requerida"),
	subtitle_default: z.string().min(1, "El subtitulo default es requerido"),
	description_default: z.string().min(1, "La descripcion default es requerida"),
	image: r2Key(),
	period_default: z.string().min(1, "El periodo default es requerido"),
	translations: z
		.array(educationTranslationInputSchema)
		.default([])
		.refine((list) => !hasDuplicateLocales(list), "Idioma repetido"),
});

export type EducationAdminInput = z.infer<typeof educationAdminInputSchema>;
