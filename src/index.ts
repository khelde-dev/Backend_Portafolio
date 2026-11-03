import { Hono, type MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { etag } from "hono/etag";
import { languageDetector } from "hono/language";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { trimTrailingSlash } from "hono/trailing-slash";
import packageJson from "../package.json" with { type: "json" };
import type { AppEnv } from "./env.js";
import { LOCALES } from "./interfaces/interfaces.js";
import {
	corsMiddleware,
	csrfMiddleware,
} from "./middleware/cors.middleware.js";
import { dbMiddleware } from "./middleware/db.middleware.js";
import {
	errorHandler,
	notFoundHandler,
} from "./middleware/errorHandler.middleware.js";
import { customLogger } from "./middleware/logger.middleware.js";
import about from "./routes/about.routes.js";
import audit from "./routes/audit.routes.js";
import comments from "./routes/comments.routes.js";
import contactInfo from "./routes/contactInfo.routes.js";
import contactMessages from "./routes/contactMessages.routes.js";
import education from "./routes/education.routes.js";
import experiences from "./routes/experiences.routes.js";
import media from "./routes/media.routes.js";
import projects from "./routes/projects.routes.js";
import skills from "./routes/skills.routes.js";

// Prefijo informativo, NO secreto: la seguridad real vive en el bearer
// token, Cloudflare Access (rutas del CMS) y el rate limit.
const app = new Hono<AppEnv>().basePath("/api");

// --- Middlewares globales, en orden (modelo onion de Hono) ---
app.use("*", requestId());
app.use("*", customLogger);

// Toda excepcion (HTTPException o no) y toda ruta inexistente responden con
// el mismo JSON { success, message }; el detalle interno solo va al log.
app.onError(errorHandler);
app.notFound(notFoundHandler);

app.use("*", trimTrailingSlash());
app.use("*", secureHeaders());
app.use("*", corsMiddleware());
// ?currentLocale= (es-MX -> es por truncamiento progresivo); API sin estado.
app.use(
	"*",
	languageDetector({
		order: ["querystring"],
		lookupQueryString: "currentLocale",
		supportedLanguages: [...LOCALES],
		fallbackLanguage: "es",
		caches: false,
	}),
);
// hono/csrf trata cualquier request SIN Content-Type como "text/plain" y la
// bloquea si tampoco trae Origin: todo cliente debe mandar
// Content-Type: application/json en CADA escritura, incluidas las que no
// llevan body (un DELETE).
app.use("*", csrfMiddleware());
// /api/media sube imagenes: tiene su propio tope (2 MB) y mas tiempo (ver
// routes/media.routes.ts), asi que los limites globales de abajo no le aplican.
const unlessMedia =
	(middleware: MiddlewareHandler<AppEnv>): MiddlewareHandler<AppEnv> =>
	(c, next) =>
		c.req.path.startsWith("/api/media") ? next() : middleware(c, next);

// 50kb: todos los payloads son formularios/JSON chicos.
app.use("*", unlessMedia(bodyLimit({ maxSize: 50 * 1024 })));
app.use("*", etag());
app.use("*", unlessMedia(timeout(10_000)));
app.use(prettyJSON({ space: 4 }));

app.get("/", async (c) => {
	return c.json({
		name: "Backend_Portafolio",
		description: "API de contenido del portafolio (Hono en Cloudflare Workers)",
		version: packageJson.version,
		author_name: "Erick Muke",
		github_name: "https://github.com/muke78",
	});
});

// Todo lo registrado despues exige el bearer token (el del proxy del
// portafolio). Las escrituras del CMS exigen ADEMAS la sesion de Cloudflare
// Access (accessAuth, dentro de cada router).
app.use("*", async (c, next) => {
	const handler = bearerAuth({
		token: c.env.API_TOKEN,
		noAuthenticationHeaderMessage: "No Authorization header",
		invalidAuthenticationHeaderMessage: "Invalid Authorization header",
		invalidTokenMessage: "Invalid token",
	});
	return (handler as MiddlewareHandler<AppEnv>)(c, next);
});
app.use("*", dbMiddleware);

app.route("/comments", comments);
app.route("/projects", projects);
app.route("/experiences", experiences);
app.route("/contact-messages", contactMessages);
app.route("/contact-info", contactInfo);
app.route("/about", about);
app.route("/education", education);
app.route("/skills", skills);
app.route("/media", media);
app.route("/audit", audit);

export default app;

// Cliente RPC tipado de Hono (`hono/client`) para el admin.
export type AppType = typeof app;
