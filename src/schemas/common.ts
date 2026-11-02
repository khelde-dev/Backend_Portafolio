import { sql } from "drizzle-orm";
import { text } from "drizzle-orm/sqlite-core";

/** Columnas de auditoria compartidas por todas las tablas. */
export const timestamps = {
	created_at: text("created_at").notNull().default(sql`(current_timestamp)`),
	updated_at: text("updated_at").notNull().default(sql`(current_timestamp)`),
};

/** Columna JSON de traducciones (ver lib/translations.ts). */
export const translationsColumn = () =>
	text("translations").notNull().default("{}");
