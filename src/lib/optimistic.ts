import { type AnyColumn, and, eq, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

/**
 * Edicion simultanea. Hay un solo usuario, pero dos pestanas abiertas pueden
 * pisarse: el formulario manda el `updated_at` que leyo y, si la fila ya cambio,
 * el backend responde 409 en lugar de reemplazarla. Sin `updated_at` el PUT se
 * comporta como siempre (reemplazo completo).
 */
export const STALE_MESSAGE =
	"Este elemento cambió desde que lo abriste. Recarga para ver la versión nueva.";

export const staleConflict = () =>
	new HTTPException(409, { message: STALE_MESSAGE });

/** Separa del cuerpo el `updated_at` leido: no es un dato de la fila, es la condicion. */
export const splitExpected = <T extends { updated_at?: string }>(
	input: T,
): { expected: string | undefined; data: Omit<T, "updated_at"> } => {
	const { updated_at: expected, ...data } = input;
	return { expected, data };
};

/** Condicion de `WHERE`: la fila sigue como la leyo el formulario (o no se pidio comprobarlo). */
export const unchangedSince = (
	column: AnyColumn,
	expected: string | undefined,
): SQL | undefined => (expected ? eq(column, expected) : undefined);

export const andWith = (condition: SQL, extra: SQL | undefined) =>
	extra ? and(condition, extra) : condition;
