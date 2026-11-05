import { eq } from "drizzle-orm";
import type { Db } from "../lib/db.js";
import { siteCopy } from "../schemas/siteCopy.js";

// Singleton: la clave del CV vive en la fila 1 de site_copy (ver schemas/siteCopy.ts).
const SITE_COPY_ID = 1;

/** Clave en R2 del PDF actual, o null si no hay (o si todavia no existe la fila). */
export async function GetCvKey(db: Db): Promise<string | null> {
	const [row] = await db
		.select({ key: siteCopy.cv_pdf_key })
		.from(siteCopy)
		.where(eq(siteCopy.site_copy_id, SITE_COPY_ID));
	return row?.key ?? null;
}

/**
 * Guarda (o quita) la clave del PDF. NO toca `updated_at`: el formulario de Textos
 * se edita con control de concurrencia sobre esa fecha, y subir el CV no debe hacerle
 * creer que otra pestana cambio los textos. Devuelve false si la fila no existe.
 */
export async function SetCvKey(db: Db, key: string | null): Promise<boolean> {
	const updated = await db
		.update(siteCopy)
		.set({ cv_pdf_key: key })
		.where(eq(siteCopy.site_copy_id, SITE_COPY_ID))
		.returning({ id: siteCopy.site_copy_id });
	return updated.length > 0;
}
