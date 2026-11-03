import { eq, sql } from "drizzle-orm";
import type { Db } from "../lib/db.js";
import { staleConflict, unchangedSince } from "../lib/optimistic.js";
import type { ContactInfoInput } from "../schemas/contactInfo.js";
import { contactInfo } from "../schemas/contactInfo.js";

// Singleton: siempre contact_id = 1 (ver schemas/contactInfo.ts).
const CONTACT_ID = 1;

const readRow = async (db: Db) => {
	const [row] = await db
		.select()
		.from(contactInfo)
		.where(eq(contactInfo.contact_id, CONTACT_ID));
	return row ?? null;
};

/** Lo que ve el sitio publico: solo los datos, sin ids ni fechas. */
export async function GetContactInfo(db: Db) {
	const row = await readRow(db);
	if (!row) return null;
	return {
		github_url: row.github_url,
		linkedin_url: row.linkedin_url,
		linkedin_name: row.linkedin_name,
		phone: row.phone,
		email: row.email,
	};
}

export async function GetContactInfoAdmin(db: Db) {
	return readRow(db);
}

// Un solo upsert: crea la fila la primera vez y la reemplaza despues.
export async function UpdateContactInfo(
	db: Db,
	input: ContactInfoInput,
	expected?: string,
) {
	const [saved] = await db
		.insert(contactInfo)
		.values({ contact_id: CONTACT_ID, ...input })
		.onConflictDoUpdate({
			target: contactInfo.contact_id,
			set: { ...input, updated_at: sql`current_timestamp` },
			// Si la fila cambio desde que se leyo, no se pisa (ver lib/optimistic.ts).
			setWhere: unchangedSince(contactInfo.updated_at, expected),
		})
		.returning();
	if (!saved) throw staleConflict();
	return saved;
}
