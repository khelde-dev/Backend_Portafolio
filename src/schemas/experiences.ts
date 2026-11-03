import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { LOCALES } from "../lib/constants.js";
import { hasDuplicateLocales } from "../lib/translations.js";
import { r2Key } from "../lib/validators.js";
import { timestamps, translationsColumn } from "./common.js";

export const experience = sqliteTable("experience", {
	experience_id: int("id").primaryKey({ autoIncrement: true }).notNull(),
	sort_order: int("sort_order").notNull().default(0),
	work_default: text("work_default"),
	title_default: text("title_default").notNull(),
	subtitle_default: text("subtitle_default").notNull(),
	img: text("img").notNull(),
	alt: text("alt").notNull(),
	time_default: text("time_default").notNull(),
	location_default: text("location_default").notNull(),
	translations: translationsColumn(),
	...timestamps,
});

const experienceTranslationInputSchema = z.object({
	locale: z.enum(LOCALES),
	work: z.string().max(100).optional().nullable(),
	title: z.string().min(1).optional(),
	subtitle: z.string().min(1).optional(),
	time: z.string().min(1).optional(),
	location: z.string().min(1).optional(),
});

export const experienceAdminInputSchema = z.object({
	// El `updated_at` que leyo el formulario: si la fila ya cambio, el PUT da 409.
	updated_at: z.string().max(40).optional(),
	sort_order: z.number().int().default(0),
	work_default: z.string().max(100).optional().nullable(),
	title_default: z.string().min(1, "El titulo default es requerido"),
	subtitle_default: z.string().min(1, "El subtitulo default es requerido"),
	img: r2Key(),
	alt: z.string().min(1, "El alt es requerido"),
	time_default: z.string().min(1, "El tiempo default es requerido"),
	location_default: z.string().min(1, "La ubicacion default es requerida"),
	translations: z
		.array(experienceTranslationInputSchema)
		.default([])
		.refine((list) => !hasDuplicateLocales(list), "Idioma repetido"),
});

export type ExperienceAdminInput = z.infer<typeof experienceAdminInputSchema>;
