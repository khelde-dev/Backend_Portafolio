import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env.js";

/**
 * `?currentLocale=` sigue siendo obligatorio (un valor ausente es
 * exactamente el bug historico que ya paso una vez: el proxy de Astro
 * olvido reenviarlo en escrituras admin - ver docs/03-diseno-api.md del
 * repo Portafolio). Lo que cambia con `hono/language` (index.ts): un
 * valor PRESENTE pero no exacto ("es-MX", "ES" en mayusculas) ya no se
 * rechaza con 400 - se normaliza al soportado mas cercano por
 * truncamiento progresivo, o cae al fallback ("es") si no matchea nada.
 * Antes esto se validaba a mano con `LOCALES.includes(currentLocale)`,
 * exacto y sensible a mayusculas - mas estricto de lo que hace falta
 * para un parametro de idioma.
 */
export const requireLocale = (c: Context<AppEnv>): string => {
	if (!c.req.query("currentLocale")) {
		throw new HTTPException(400, {
			message: "Falta el parámetro currentLocale",
		});
	}
	return c.get("language");
};
