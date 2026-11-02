import type { Context, Next } from "hono";

// Log a consola, no a archivo. Este backend corre como funcion serverless
// en Vercel (confirmado: .vercel/project.json enlazado, sin server.listen
// propio) - el filesystem ahi es de solo lectura en produccion, escribir a
// src/logs/*.log con fs.appendFile nunca funciono en produccion, solo en
// local (el catch silencioso lo escondia). Vercel captura stdout/stderr
// nativamente en el dashboard de Functions - ese es el sink real.
export const customLogger = async (c: Context, next: Next) => {
	const start = Date.now();

	await next();

	const ms = Date.now() - start;
	const requestId = c.get("requestId") ?? "-";
	console.log(
		`[${new Date().toISOString()}] [${requestId}] ${c.req.method} ${c.req.url} ${c.res.status} - ${ms}ms`,
	);
};
