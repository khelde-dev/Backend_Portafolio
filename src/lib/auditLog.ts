import { desc, sql } from "drizzle-orm";
import { type AUDIT_ACTIONS, auditLogs } from "../schemas/auditLog.js";
import type { Db } from "./db.js";

/** Cuantas filas se conservan: para un solo usuario es historial de sobra. */
export const AUDIT_RETENTION = 1000;
const SUMMARY_MAX = 120;

/** Frase corta y de una sola linea; nunca el contenido completo de nada. */
export const toSummary = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const text = value.replace(/\s+/g, " ").trim();
	if (!text) return null;
	return text.length > SUMMARY_MAX
		? `${text.slice(0, SUMMARY_MAX - 1)}…`
		: text;
};

/**
 * Log de auditoria para escrituras admin - quien, que recurso, que accion,
 * cuando. Escribe en consola (OWASP A09) y ademas guarda la fila en `audit_log`
 * para la pantalla Actividad del CMS, conservando solo las ultimas
 * `AUDIT_RETENTION`.
 *
 * Es de mejor esfuerzo: la escritura que se audita ya ocurrio, asi que un fallo
 * al guardar el historial se registra y no la convierte en un error.
 */
export const auditLog = async (params: {
	db: Db;
	adminEmail: string;
	action: (typeof AUDIT_ACTIONS)[number];
	resource: string;
	resourceId: number | string;
	summary?: unknown;
}): Promise<void> => {
	const { db, adminEmail, action, resource, resourceId } = params;
	console.log(
		`[AUDIT] [${new Date().toISOString()}] ${adminEmail} ${action} ${resource}/${resourceId}`,
	);
	try {
		await db.batch([
			db.insert(auditLogs).values({
				admin_email: adminEmail,
				action,
				resource,
				resource_id: String(resourceId),
				summary: toSummary(params.summary),
			}),
			db
				.delete(auditLogs)
				.where(
					sql`${auditLogs.id} NOT IN (SELECT ${auditLogs.id} FROM ${auditLogs} ORDER BY ${auditLogs.id} DESC LIMIT ${AUDIT_RETENTION})`,
				),
		]);
	} catch {
		// Sin detalle: ni el error crudo ni los datos de la peticion.
		console.error("[AUDIT] no se pudo guardar el historial");
	}
};

export const listAudit = (db: Db, limit: number) =>
	db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(limit);
