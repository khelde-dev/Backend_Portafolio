import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { CONTACT_MESSAGE_STATUSES } from "../lib/constants.js";
import { timestamps } from "./common.js";

export const contactMessages = sqliteTable("contact_messages", {
	message_id: int("id").primaryKey({ autoIncrement: true }).notNull(),
	name: text("name").notNull(),
	email: text("email").notNull(),
	phone: text("phone").notNull(),
	// Opcional: el formulario del portafolio lo marca "(opcional)".
	more_information: text("more_information"),
	status: text("status", { enum: CONTACT_MESSAGE_STATUSES })
		.notNull()
		.default("unread"),
	replied_at: text("replied_at"),
	...timestamps,
});

export const insertContactMessageSchema = createInsertSchema(contactMessages, {
	name: z
		.string()
		.min(1, "El nombre es requerido")
		.max(100, "El nombre es muy largo"),
	email: z.email("Correo invalido"),
	phone: z
		.string()
		.min(7, "El telefono es muy corto")
		.max(20, "El telefono es muy largo"),
	more_information: z.string().max(1000, "El mensaje es muy largo").optional(),
	status: z.enum(CONTACT_MESSAGE_STATUSES),
}).omit({
	message_id: true,
	replied_at: true,
	created_at: true,
	updated_at: true,
});

export const contactMessageUserInputSchema = insertContactMessageSchema.omit({
	status: true,
});

export const selectContactMessageSchema = createSelectSchema(contactMessages);

export const listContactMessagesQuerySchema = z.object({
	status: z.enum(CONTACT_MESSAGE_STATUSES).optional(),
});

export const updateContactMessageStatusSchema = z.object({
	status: z.enum(CONTACT_MESSAGE_STATUSES),
});

export type InsertContactMessage = z.infer<typeof insertContactMessageSchema>;
export type ContactMessageUserInput = z.infer<
	typeof contactMessageUserInputSchema
>;
export type SelectContactMessage = z.infer<typeof selectContactMessageSchema>;
export type UpdateContactMessageStatusInput = z.infer<
	typeof updateContactMessageStatusSchema
>;
