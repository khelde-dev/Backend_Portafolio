import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { auditLog } from "./auditLog.js";
import type { Db } from "./db.js";
import { zodErrorHook } from "./zodErrorHook.js";

/**
 * Reordenar en lote: `PUT /<recurso>/order` con `[{ id, sort_order }]`. Una sola
 * peticion y una sola transaccion (`db.batch`), en lugar de un PUT por fila con el
 * objeto completo. Las listas son de decenas de filas, asi que el tope es holgado.
 */
export const orderInputSchema = z
	.array(
		z.object({
			id: z.number().int().positive(),
			sort_order: z.number().int().min(0).max(100_000),
		}),
	)
	.min(1, "No hay nada que ordenar")
	.max(200, "Demasiados elementos")
	.refine(
		(items) => new Set(items.map((i) => i.id)).size === items.length,
		"Hay ids repetidos",
	);

export type OrderInput = z.infer<typeof orderInputSchema>;

interface OrderTarget {
	/** Nombre del recurso para la auditoria (`projects`, `skills`...). */
	resource: string;
	table: SQLiteTable;
	idColumn: AnySQLiteColumn;
	/** Columna `sort_order` de la tabla. */
	sortColumn: AnySQLiteColumn;
	/** Columna `updated_at`: cambiar el orden tambien es editar la fila. */
	updatedColumn: AnySQLiteColumn;
}

/** Aplica el orden y devuelve cuantas filas existian (las demas ya no estaban). */
export async function applyOrder(
	db: Db,
	{ table, idColumn, sortColumn, updatedColumn }: OrderTarget,
	items: OrderInput,
): Promise<{ updated: number; requested: number }> {
	const statements = items.map(({ id, sort_order }) =>
		db
			.update(table)
			// biome-ignore lint/suspicious/noExplicitAny: las columnas llegan como parametros genericos
			.set({
				[sortColumn.name]: sort_order,
				[updatedColumn.name]: sql`current_timestamp`,
			} as any)
			.where(eq(idColumn, id))
			.returning({ id: idColumn }),
	);
	// biome-ignore lint/suspicious/noExplicitAny: batch exige una tupla no vacia
	const results = (await db.batch(statements as any)) as unknown[][];
	return {
		updated: results.reduce((total, rows) => total + rows.length, 0),
		requested: items.length,
	};
}

/**
 * Registra `PUT /order` en el router. Debe llamarse ANTES de las rutas `/:id`,
 * o "order" se tomaria por un id.
 */
export const registerOrderRoute = (
	router: Hono<AppEnv>,
	target: OrderTarget,
) => {
	router.put(
		"/order",
		accessAuth,
		zValidator("json", orderInputSchema, zodErrorHook),
		async (c) => {
			const result = await applyOrder(c.get("db"), target, c.req.valid("json"));
			auditLog({
				adminEmail: adminEmail(c),
				action: "update",
				resource: target.resource,
				resourceId: "order",
			});
			return c.json(
				{ success: true, data: result } as ApiResponse<typeof result>,
				200,
			);
		},
	);
};
