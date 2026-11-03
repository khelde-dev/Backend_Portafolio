import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";
import { z } from "zod";
import { GetMediaUsage, ListMedia } from "../controllers/media.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import {
	IMAGE_CACHE_CONTROL,
	isSafeKey,
	MAX_IMAGE_BYTES,
	MAX_IMAGE_DIMENSION,
	MEDIA_AREAS,
	newMediaKey,
	normalizeKey,
	publicUrl,
} from "../lib/media.js";
import { inspectWebp } from "../lib/webp.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";

const router = new Hono<AppEnv>();

// Todo el modulo es del CMS: bearer (global) + sesion de Access.
router.use("*", accessAuth);

const uploadQuery = z.object({
	use: z.enum(MEDIA_AREAS, { error: "Carpeta no válida" }),
});

// GET /media - objetos del bucket con donde se usa cada uno ("Sin uso" = huerfana).
router.get("/", async (c) => {
	const result = await ListMedia(c.env.MEDIA, c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// POST /media?use=projects - sube UNA imagen WebP. Cuerpo binario con
// `Content-Type: image/webp` (no multipart: el CSRF de Hono bloquea formularios).
// El servidor genera la clave; el cliente solo elige la carpeta.
router.post(
	"/",
	// Este modulo NO usa el tope de 50 KB ni los 10 s globales (index.ts los
	// excluye): una imagen tiene su propio limite y mas tiempo.
	bodyLimit({
		maxSize: MAX_IMAGE_BYTES,
		onError: () => {
			throw new HTTPException(413, { message: "La imagen supera los 2 MB" });
		},
	}),
	timeout(30_000),
	zValidator("query", uploadQuery, zodErrorHook),
	async (c) => {
		const { use } = c.req.valid("query");

		const type = (c.req.header("content-type") ?? "")
			.split(";")[0]
			.trim()
			.toLowerCase();
		if (type !== "image/webp") {
			throw new HTTPException(415, {
				message: "Solo se aceptan imágenes WebP",
			});
		}

		const bytes = new Uint8Array(await c.req.arrayBuffer());
		if (bytes.length === 0) {
			throw new HTTPException(400, { message: "La imagen está vacía" });
		}
		if (bytes.length > MAX_IMAGE_BYTES) {
			throw new HTTPException(413, { message: "La imagen supera los 2 MB" });
		}

		// La cabecera Content-Type la puede mandar cualquiera: se mira el archivo.
		const info = inspectWebp(bytes);
		if (!info) {
			throw new HTTPException(400, {
				message: "El archivo no es un WebP válido",
			});
		}
		if (info.width > MAX_IMAGE_DIMENSION || info.height > MAX_IMAGE_DIMENSION) {
			throw new HTTPException(400, {
				message: `La imagen supera ${MAX_IMAGE_DIMENSION} px de ancho o de alto`,
			});
		}

		const key = newMediaKey(use);
		await c.env.MEDIA.put(key, bytes, {
			httpMetadata: {
				contentType: "image/webp",
				cacheControl: IMAGE_CACHE_CONTROL,
			},
			customMetadata: { uploadedBy: adminEmail(c), folder: use },
		});
		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "create",
			resource: "media",
			resourceId: key,
		});

		const data = {
			key,
			url: publicUrl(c.env.PUBLIC_MEDIA_URL, key),
			size: bytes.length,
			width: info.width,
			height: info.height,
		};
		return c.json(
			{ success: true, data, message: "Imagen subida" } as ApiResponse<
				typeof data
			>,
			201,
		);
	},
);

// DELETE /media/<clave> - borra UNA imagen si ninguna fila la usa. R2 no tiene
// papelera: el borrado es definitivo, por eso 409 si esta en uso.
router.delete("/:key{.+}", async (c) => {
	const key = normalizeKey(c.req.param("key"));
	if (!isSafeKey(key)) {
		throw new HTTPException(400, { message: "Clave de imagen no válida" });
	}

	const head = await c.env.MEDIA.head(key);
	if (!head) throw new HTTPException(404, { message: "La imagen no existe" });

	const usedBy = (await GetMediaUsage(c.get("db"))).get(key) ?? [];
	if (usedBy.length > 0) {
		return c.json(
			{ success: false, message: "La imagen está en uso", data: { usedBy } },
			409,
		);
	}

	await c.env.MEDIA.delete(key);
	await auditLog({
		db: c.get("db"),
		adminEmail: adminEmail(c),
		action: "delete",
		resource: "media",
		resourceId: key,
	});
	return c.json(
		{ success: true, data: { key } } as ApiResponse<{ key: string }>,
		200,
	);
});

export default router;
