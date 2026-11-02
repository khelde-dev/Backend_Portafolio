import type { Context } from "hono";
import type { ApiResponse } from "../interfaces/interfaces.js";

/**
 * Hook de error compartido para `zValidator` (@hono/zod-validator). Sin
 * esto, la libreria devuelve el ZodError crudo
 * ({success:false, error:{name,message,...}}) - inconsistente con el
 * shape ApiResponse que usa toda la API, y expone la forma interna del
 * schema. Extraido a un solo lugar (antes vivia duplicado, copiado en
 * cada archivo de rutas que usa zValidator) para no repetir las mismas
 * 10 lineas en cada router nuevo.
 *
 * `result: any`: el tipo real que exige `zValidator` es un `Hook<T, ...>`
 * generico DISTINTO para cada schema (T cambia por endpoint) - una
 * funcion no generica no puede satisfacer esa forma para todos los
 * schemas a la vez sin repetir la firma completa de Hono por cada uso,
 * que es exactamente la duplicacion que este helper busca evitar. Solo
 * se usan `result.success`/`result.error.issues`, estables en cualquier
 * version de zod.
 */
// biome-ignore lint/suspicious/noExplicitAny: ver comentario del modulo
export const zodErrorHook = (result: any, c: Context) => {
	if (!result.success) {
		return c.json(
			{
				success: false,
				message: "Datos invalidos",
				errors: result.error.issues,
			} as ApiResponse<null>,
			400,
		);
	}
};
