import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";

/**
 * Limite de peticiones por IP para los POST publicos (comentarios y contacto).
 *
 * En Cloudflare se usa el binding de Rate Limiting (RL_PUBLIC_WRITE), que
 * Cloudflare comparte entre todos los isolates. Si el binding no existe
 * (pruebas, `bun test`) cae a un contador en memoria: sirve para un solo
 * proceso, pero NO es una garantia en produccion.
 */
const buckets = new Map<string, { count: number; windowStart: number }>();

const isRateLimited = (
	key: string,
	{ limit, windowMs }: { limit: number; windowMs: number },
): boolean => {
	const now = Date.now();
	const bucket = buckets.get(key);

	if (!bucket || now - bucket.windowStart > windowMs) {
		buckets.set(key, { count: 1, windowStart: now });
		for (const [k, b] of buckets) {
			if (k !== key && now - b.windowStart > windowMs) buckets.delete(k);
		}
		return false;
	}

	bucket.count += 1;
	return bucket.count > limit;
};

/** Direcciones IPv4 o IPv6 en texto; cualquier otra cosa se ignora. */
const IP_FORMAT = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * Quien hace la peticion. El sitio publico llama desde su Worker, asi que
 * `cf-connecting-ip` es la IP de ESE Worker y todos los visitantes compartirian un
 * solo cupo: el sitio manda la IP real en `X-Visitor-IP`. Se confia en esa cabecera
 * porque este middleware corre despues del bearer token (index.ts): solo la manda
 * quien ya tiene el token del sitio. Sin ella (clientes directos) manda la IP de Cloudflare.
 */
const clientKey = (c: Context): string => {
	const visitor = c.req.header("x-visitor-ip")?.trim();
	if (visitor && IP_FORMAT.test(visitor)) return visitor;
	return connectionKey(c);
};

const connectionKey = (c: Context): string =>
	c.req.header("cf-connecting-ip") ??
	c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
	c.req.header("x-real-ip") ??
	"unknown";

export const rateLimit = ({
	limit,
	windowMs,
}: {
	limit: number;
	windowMs: number;
}) =>
	createMiddleware<AppEnv>(async (c, next) => {
		const key = `${c.req.path}:${clientKey(c)}`;
		const binding = c.env?.RL_PUBLIC_WRITE;

		const blocked = binding
			? !(await binding.limit({ key })).success
			: isRateLimited(key, { limit, windowMs });

		if (blocked) {
			return c.json(
				{ success: false, message: "Too many requests, try again later" },
				429,
			);
		}
		await next();
	});
