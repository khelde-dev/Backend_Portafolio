import { sql } from "drizzle-orm";
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

export const AUDIT_ACTIONS = ["create", "update", "delete"] as const;

/**
 * Historial de lo que se cambia desde el CMS. Solo lo escribe el backend, en la
 * misma peticion que hace el cambio. Sin cuerpos completos ni datos personales
 * de los mensajes: `summary` es una frase corta ("Mi proyecto").
 */
export const auditLogs = sqliteTable("audit_log", {
	id: int("id").primaryKey({ autoIncrement: true }),
	at: text("at").notNull().default(sql`(current_timestamp)`),
	admin_email: text("admin_email").notNull(),
	action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
	resource: text("resource").notNull(),
	resource_id: text("resource_id").notNull(),
	summary: text("summary"),
});

export const auditQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(1000).default(200),
});
