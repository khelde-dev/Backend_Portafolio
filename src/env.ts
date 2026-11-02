import type { JwtVariables } from "hono/jwt";
import type { LanguageVariables } from "hono/language";
import type { RequestIdVariables } from "hono/request-id";
import type { Db } from "./lib/db.js";

/** Binding de Rate Limiting de Cloudflare. */
export interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Bindings, variables y secretos del Worker (ver wrangler.jsonc). */
export type Bindings = {
	DB: D1Database;
	MEDIA: R2Bucket;
	/** Secreto: bearer token que usa el proxy del portafolio. */
	API_TOKEN: string;
	ACCESS_TEAM_DOMAIN: string;
	ACCESS_AUD: string;
	/** Llaves publicas fijas (JSON {keys:[...]}) en lugar de bajarlas de Access: pruebas y local. */
	ACCESS_JWKS?: string;
	ALLOWED_ORIGINS?: string;
	PUBLIC_MEDIA_URL?: string;
	RL_PUBLIC_WRITE?: RateLimiter;
};

export type AppVariables = RequestIdVariables &
	LanguageVariables &
	JwtVariables & { db: Db };

export type AppEnv = { Bindings: Bindings; Variables: AppVariables };
