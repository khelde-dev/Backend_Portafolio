import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyWithJwks } from "hono/jwt";
import type { AppEnv } from "../env.js";

/** Cabecera donde Cloudflare Access entrega el JWT de la sesion. */
export const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

const trimSlash = (url: string) => url.replace(/\/$/, "");

/**
 * Protege las rutas de escritura del CMS. Cloudflare Access hace el login
 * (SSO / codigo por correo) ANTES de que la peticion llegue al Worker y le
 * agrega un JWT firmado; aqui solo se verifica esa firma, la audiencia (AUD
 * de la aplicacion en Access) y el emisor. No hay contrasenas ni tabla de
 * usuarios.
 */
export const accessAuth = createMiddleware<AppEnv>(async (c, next) => {
	const { ACCESS_AUD: aud, ACCESS_TEAM_DOMAIN: team, ACCESS_JWKS } = c.env;

	if (!aud || (!team && !ACCESS_JWKS)) {
		throw new HTTPException(503, {
			message: "Cloudflare Access no esta configurado",
		});
	}

	const token = c.req.header(ACCESS_HEADER);
	if (!token) {
		throw new HTTPException(401, {
			message: "Falta la sesion de Cloudflare Access",
		});
	}

	try {
		const payload = await verifyWithJwks(
			token,
			{
				...(ACCESS_JWKS
					? { keys: JSON.parse(ACCESS_JWKS).keys }
					: { jwks_uri: `${trimSlash(team)}/cdn-cgi/access/certs` }),
				allowedAlgorithms: ["RS256"],
				verification: { aud, ...(team ? { iss: trimSlash(team) } : {}) },
			},
			// Las llaves publicas cambian rara vez: que Cloudflare las guarde en cache.
			{ cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit,
		);
		// Access siempre firma con expiracion; un token sin `exp` nunca caducaria.
		if (typeof payload.exp !== "number") throw new Error("token sin exp");
		c.set("jwtPayload", payload);
	} catch {
		throw new HTTPException(401, { message: "Sesion de Access invalida" });
	}

	await next();
});

/** Quien hizo la escritura, para el log de auditoria. */
export const adminEmail = (c: Context<AppEnv>): string => {
	const payload = c.get("jwtPayload") as Record<string, unknown> | undefined;
	return String(payload?.email ?? payload?.common_name ?? "desconocido");
};
