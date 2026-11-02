import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { COMMENT_STATUSES } from "../lib/constants.js";
import { timestamps } from "./common.js";

export const comments = sqliteTable("comments", {
	comment_id: int("id").primaryKey({ autoIncrement: true }).notNull(),
	name: text("name").notNull(),
	job: text("job"), // Opcional
	description: text("description").notNull(),
	direction: text("direction").notNull(),
	country_flag: text("country_flag").notNull(),
	country: text("country").notNull(),
	status: text("status", { enum: COMMENT_STATUSES })
		.notNull()
		.default("pending"),
	...timestamps,
});

export const insertCommentsSchema = createInsertSchema(comments, {
	name: z
		.string()
		.min(1, "El nombre es requerido")
		.max(100, "El nombre es muy largo"),
	job: z.string().max(100, "El trabajo es muy largo").optional(),
	description: z
		.string()
		.min(14, "La descripción es requerida")
		.max(500, "La descripción es muy larga"),
	direction: z.enum(["left", "bottom"], {
		message: "La dirección debe ser 'left' o 'bottom'",
	}),
	country_flag: z.string(),
	country: z.string(),
	status: z.enum(COMMENT_STATUSES),
}).omit({ comment_id: true, created_at: true, updated_at: true });

export const userInputSchema = insertCommentsSchema.omit({
	direction: true,
	status: true,
});

export const selectCommentsSchema = createSelectSchema(comments);

export const updateCommentStatusSchema = z.object({
	status: z.enum(COMMENT_STATUSES),
});

export type InsertComment = z.infer<typeof insertCommentsSchema>;
export type UserInputComment = z.infer<typeof userInputSchema>;
export type SelectComment = z.infer<typeof selectCommentsSchema>;
export type UpdateCommentStatusInput = z.infer<
	typeof updateCommentStatusSchema
>;
