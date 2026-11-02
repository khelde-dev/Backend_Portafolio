import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";

// Se registra con `app.onError(...)`, NO con `app.use(...)`: Hono manda toda
// excepcion lanzada dentro de un handler o middleware a `onError` antes de que
// suba a un `try/catch` de un middleware anterior, asi que un middleware que
// envuelva `next()` nunca llega a verlas (las respuestas salian en texto plano).
export const errorHandler: ErrorHandler = async (err, c: Context) => {
	const requestId = c.get("requestId") ?? "-";

	if (err instanceof HTTPException) {
		// Fallos esperados: auth, body-limit, csrf, timeout, rate limit,
		// validacion - conservar su status/mensaje real en vez de aplanar
		// todo a 500.
		console.warn(
			`[${new Date().toISOString()}] [${requestId}] ${err.status}: ${err.message}`,
		);
		// WWW-Authenticate (bearer) sirve al cliente para saber como autenticarse.
		const upstream = err.getResponse();
		const challenge = upstream.headers.get("WWW-Authenticate");
		// Algunos middlewares de Hono (bearerAuth) ponen el texto en la
		// respuesta de la excepcion y dejan `message` vacio.
		const message =
			err.message ||
			(await upstream
				.clone()
				.text()
				.catch(() => "")) ||
			"Request failed";
		return c.json(
			{ success: false, message },
			err.status,
			challenge ? { "WWW-Authenticate": challenge } : undefined,
		);
	}

	const message = err instanceof Error ? err.message : "Unknown error";
	const stack = err instanceof Error ? err.stack : "No stack";
	console.error(
		`[${new Date().toISOString()}] [${requestId}] ERROR: ${message}\nStack: ${stack}`,
	);

	// Nunca se devuelve el detalle del error: solo se registra en el log.
	return c.json({ success: false, message: "Internal Server Error" }, 500);
};

export const notFoundHandler: NotFoundHandler = (c) =>
	c.json({ success: false, message: "Not Found" }, 404);
