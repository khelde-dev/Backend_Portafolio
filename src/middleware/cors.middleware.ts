import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import type { AppEnv } from "../env.js";

/** Origenes del navegador permitidos (variable ALLOWED_ORIGINS, separados por coma). */
export const allowedOrigins = (env: AppEnv["Bindings"] | undefined): string[] =>
	(env?.ALLOWED_ORIGINS ?? "")
		.split(",")
		.map((o) => o.trim())
		.filter(Boolean);

export const corsMiddleware = () => (c: Context<AppEnv>, next: Next) => {
	const allowed = allowedOrigins(c.env);
	return cors({
		origin: (origin) => (allowed.includes(origin) ? origin : null),
		allowHeaders: ["Authorization", "Content-Type"],
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		credentials: true,
		maxAge: 600,
	})(c, next);
};

// Mismo criterio para CSRF: los clientes servidor-a-servidor (el proxy del
// portafolio) no mandan Origin y mandan Content-Type: application/json en
// cada escritura; los navegadores solo pasan desde un origen permitido.
export const csrfMiddleware = () => (c: Context<AppEnv>, next: Next) => {
	const allowed = allowedOrigins(c.env);
	return csrf({ origin: (origin) => allowed.includes(origin) })(c, next);
};
