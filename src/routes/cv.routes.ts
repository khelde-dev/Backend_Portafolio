import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";
import { GetCvKey, SetCvKey } from "../controllers/cv.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import {
	CV_CACHE_CONTROL,
	CV_CONTENT_DISPOSITION,
	looksLikePdf,
	MAX_CV_BYTES,
	newCvKey,
} from "../lib/cv.js";
import { publicUrl } from "../lib/media.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";

const router = new Hono<AppEnv>();

// Todo el modulo es del CMS: bearer (global) + sesion de Access.
router.use("*", accessAuth);

const NOT_READY =
	"Guarda primero los textos del sitio y despues sube el currículum";

// GET /cv - el PDF actual (o null) con su tamano y fecha de subida.
router.get("/", async (c) => {
	const key = await GetCvKey(c.get("db"));
	let data: {
		key: string;
		url: string | null;
		size: number | null;
		uploaded: string | null;
	} | null = null;
	if (key) {
		const head = await c.env.MEDIA.head(key);
		data = {
			key,
			url: publicUrl(c.env.PUBLIC_MEDIA_URL, key),
			size: head?.size ?? null,
			uploaded: head?.uploaded.toISOString() ?? null,
		};
	}
	return c.json({ success: true, data } as ApiResponse<typeof data>, 200);
});

// POST /cv - sube UN PDF (cuerpo binario `application/pdf`) y reemplaza al anterior.
// Este modulo NO usa el tope de 50 KB ni los 10 s globales (index.ts los excluye).
router.post(
	"/",
	bodyLimit({
		maxSize: MAX_CV_BYTES,
		onError: () => {
			throw new HTTPException(413, { message: "El PDF supera los 5 MB" });
		},
	}),
	timeout(30_000),
	async (c) => {
		const type = (c.req.header("content-type") ?? "")
			.split(";")[0]
			.trim()
			.toLowerCase();
		if (type !== "application/pdf") {
			throw new HTTPException(415, { message: "Solo se aceptan archivos PDF" });
		}

		const bytes = new Uint8Array(await c.req.arrayBuffer());
		if (bytes.length === 0) {
			throw new HTTPException(400, { message: "El archivo está vacío" });
		}
		if (bytes.length > MAX_CV_BYTES) {
			throw new HTTPException(413, { message: "El PDF supera los 5 MB" });
		}
		// La cabecera Content-Type la puede mandar cualquiera: se mira el archivo.
		if (!looksLikePdf(bytes)) {
			throw new HTTPException(400, {
				message: "El archivo no es un PDF válido",
			});
		}

		const db = c.get("db");
		const previous = await GetCvKey(db);
		const key = newCvKey();

		await c.env.MEDIA.put(key, bytes, {
			httpMetadata: {
				contentType: "application/pdf",
				contentDisposition: CV_CONTENT_DISPOSITION,
				cacheControl: CV_CACHE_CONTROL,
			},
			customMetadata: { uploadedBy: adminEmail(c) },
		});

		if (!(await SetCvKey(db, key))) {
			// Sin fila de textos no hay donde guardar la clave: no se deja un objeto huerfano.
			await c.env.MEDIA.delete(key);
			throw new HTTPException(409, { message: NOT_READY });
		}

		// El anterior ya no lo usa nadie; si no se puede borrar, solo queda ocupando espacio.
		if (previous && previous !== key) {
			try {
				await c.env.MEDIA.delete(previous);
			} catch {
				console.error("[CV] no se pudo borrar el PDF anterior");
			}
		}

		await auditLog({
			db,
			adminEmail: adminEmail(c),
			action: "create",
			resource: "cv",
			resourceId: key,
		});

		const data = {
			key,
			url: publicUrl(c.env.PUBLIC_MEDIA_URL, key),
			size: bytes.length,
		};
		return c.json(
			{ success: true, data, message: "Currículum subido" } as ApiResponse<
				typeof data
			>,
			201,
		);
	},
);

// DELETE /cv - quita el PDF actual: el sitio deja de mostrar el boton.
router.delete("/", async (c) => {
	const db = c.get("db");
	const key = await GetCvKey(db);
	if (!key)
		throw new HTTPException(404, { message: "No hay currículum cargado" });

	await SetCvKey(db, null);
	try {
		await c.env.MEDIA.delete(key);
	} catch {
		console.error("[CV] no se pudo borrar el PDF");
	}
	await auditLog({
		db,
		adminEmail: adminEmail(c),
		action: "delete",
		resource: "cv",
		resourceId: key,
	});
	return c.json(
		{ success: true, data: { key } } as ApiResponse<{ key: string }>,
		200,
	);
});

export default router;
