import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { LOCALES } from "../lib/constants.js";
import { hasDuplicateLocales } from "../lib/translations.js";
import { timestamps, translationsColumn } from "./common.js";

export const skills = sqliteTable("skills", {
	skill_id: int("id").primaryKey({ autoIncrement: true }).notNull(),
	sort_order: int("sort_order").notNull().default(0),
	title_default: text("title_default").notNull(),
	images_topics: text("images_topics").notNull().default("[]"),
	translations: translationsColumn(),
	...timestamps,
});

const skillTranslationInputSchema = z.object({
	locale: z.enum(LOCALES),
	title: z.string().min(1).optional(),
});

export const skillAdminInputSchema = z.object({
	sort_order: z.number().int().default(0),
	title_default: z.string().min(1, "El titulo default es requerido"),
	images_topics: z.array(z.string()).default([]),
	translations: z
		.array(skillTranslationInputSchema)
		.default([])
		.refine((list) => !hasDuplicateLocales(list), "Idioma repetido"),
});

export type SkillAdminInput = z.infer<typeof skillAdminInputSchema>;
