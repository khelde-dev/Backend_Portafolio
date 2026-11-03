import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { CATEGORIES, LOCALES, PROJECT_STATUSES } from "../lib/constants.js";
import { hasDuplicateLocales } from "../lib/translations.js";
import { httpUrl, r2Key } from "../lib/validators.js";
import { timestamps, translationsColumn } from "./common.js";

/**
 * Proyectos. Imagenes = claves del bucket R2 (`projects/abc.webp`), nunca
 * URLs completas: la URL base es configuracion (PUBLIC_MEDIA_URL).
 * `images_topics` (stack), `gallery` y `translations` son JSON en texto.
 */
export const projects = sqliteTable(
	"projects",
	{
		project_id: int("id").primaryKey({ autoIncrement: true }).notNull(),
		slug: text("slug").notNull(),
		category: text("category", { enum: CATEGORIES }).notNull(),
		status: text("status", { enum: PROJECT_STATUSES })
			.notNull()
			.default("published"),
		featured: int("featured", { mode: "boolean" }).notNull().default(false),
		sort_order: int("sort_order").notNull().default(0),
		card_image: text("card_image").notNull(),
		gallery: text("gallery").notNull().default("[]"),
		video_url: text("video_url"),
		images_topics: text("images_topics").notNull().default("[]"),
		link_repo: text("link_repo"),
		link_web: text("link_web"),
		fork: int("fork", { mode: "boolean" }).notNull().default(false),
		title_default: text("title_default").notNull(),
		summary_default: text("summary_default").notNull(),
		description_default: text("description_default").notNull(),
		translations: translationsColumn(),
		...timestamps,
	},
	(table) => [uniqueIndex("projects_slug_unique_idx").on(table.slug)],
);

const projectTranslationInputSchema = z.object({
	locale: z.enum(LOCALES),
	title: z.string().min(1).optional(),
	summary: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
});

export const projectAdminInputSchema = z.object({
	// El `updated_at` que leyo el formulario: si la fila ya cambio, el PUT da 409.
	updated_at: z.string().max(40).optional(),
	slug: z
		.string()
		.min(1, "El slug es requerido")
		.max(100, "El slug es muy largo")
		.regex(
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
			"Slug invalido (minusculas y guiones)",
		),
	category: z.enum(CATEGORIES),
	status: z.enum(PROJECT_STATUSES).default("published"),
	featured: z.boolean().default(false),
	sort_order: z.number().int().default(0),
	card_image: r2Key(),
	gallery: z.array(r2Key()).max(50).default([]),
	video_url: httpUrl().optional().nullable(),
	images_topics: z.array(z.string()).default([]),
	link_repo: httpUrl().optional().nullable(),
	link_web: httpUrl().optional().nullable(),
	fork: z.boolean().default(false),
	title_default: z.string().min(1, "El titulo default es requerido"),
	summary_default: z.string().min(1, "El resumen default es requerido"),
	description_default: z.string().min(1, "La descripcion default es requerida"),
	translations: z
		.array(projectTranslationInputSchema)
		.default([])
		.refine((list) => !hasDuplicateLocales(list), "Idioma repetido"),
});

export type ProjectAdminInput = z.infer<typeof projectAdminInputSchema>;
