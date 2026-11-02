import { HTTPException } from "hono/http-exception";

/**
 * Convierte un param de ruta (siempre string) a un id numerico valido,
 * o corta con un 400 - hono/http-exception en vez de un c.json manual
 * (ver docs/04-hono-projects-experiences-crud.md): errorHandler.middleware.ts
 * ya sabe formatear cualquier HTTPException al shape ApiResponse, asi
 * que los route handlers no repiten esa forma a mano en cada corte
 * temprano. Antes vivia duplicado (identico) en projects.routes.ts y
 * experiences.routes.ts.
 */
export const parseId = (raw: string): number => {
	// Solo enteros positivos en decimal: Number() aceptaria "1e3", "0x10", " 1" o "".
	if (!/^[1-9][0-9]{0,14}$/.test(raw)) {
		throw new HTTPException(400, { message: "id invalido" });
	}
	return Number(raw);
};
