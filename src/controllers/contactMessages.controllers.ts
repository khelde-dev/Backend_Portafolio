import { desc, eq, sql } from "drizzle-orm";
import type {
	ContactMessageStatus,
	ContactMessageUserInput,
	SelectContactMessage,
} from "../interfaces/interfaces.js";
import type { Db } from "../lib/db.js";
import { contactMessages } from "../schemas/contactMessages.js";

// Reemplaza al modulo de Telegram - ver docs/02-comentarios-y-contacto.md.
export async function PostContactMessage(
	db: Db,
	{ name, email, phone, more_information }: ContactMessageUserInput,
): Promise<SelectContactMessage> {
	const result = await db
		.insert(contactMessages)
		.values({
			name,
			email,
			phone,
			more_information: more_information ?? null,
			status: "unread",
		})
		.returning();

	return result[0];
}

// Para el admin/dashboard - protegida por adminAuth (JWT) en
// contactMessages.routes.ts, ver docs/03-hono-admin-auth.md.
export async function GetAllContactMessages(
	db: Db,
): Promise<SelectContactMessage[]> {
	return db
		.select()
		.from(contactMessages)
		.orderBy(desc(contactMessages.created_at))
		.all();
}

// Marcar leido/respondido.
export async function UpdateContactMessageStatus(
	db: Db,
	messageId: number,
	status: ContactMessageStatus,
): Promise<SelectContactMessage | null> {
	const result = await db
		.update(contactMessages)
		.set({
			status,
			updated_at: sql`current_timestamp`,
			...(status === "replied" ? { replied_at: sql`current_timestamp` } : {}),
		})
		.where(eq(contactMessages.message_id, messageId))
		.returning();

	return result[0] ?? null;
}
