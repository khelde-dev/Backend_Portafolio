import { count, desc, eq, sql } from "drizzle-orm";
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

// Bandeja de entrada del admin (protegida por Cloudflare Access en las
// rutas). Mas reciente primero; `status` filtra (ej. solo los "unread").
export async function GetAllContactMessages(
	db: Db,
	status?: ContactMessageStatus,
): Promise<SelectContactMessage[]> {
	const query = db.select().from(contactMessages);
	return (status ? query.where(eq(contactMessages.status, status)) : query)
		.orderBy(desc(contactMessages.created_at), desc(contactMessages.message_id))
		.all();
}

// Para el globo de "sin leer" del menu del admin, sin bajar los mensajes.
export async function CountUnreadContactMessages(db: Db): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(contactMessages)
		.where(eq(contactMessages.status, "unread"));
	return row?.value ?? 0;
}

// Borrar un mensaje (spam).
export async function DeleteContactMessage(
	db: Db,
	messageId: number,
): Promise<SelectContactMessage | null> {
	const [deleted] = await db
		.delete(contactMessages)
		.where(eq(contactMessages.message_id, messageId))
		.returning();
	return deleted ?? null;
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
