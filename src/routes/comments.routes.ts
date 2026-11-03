import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	CountPendingComments,
	DeleteComment,
	GetAllComments,
	GetAllCommentsAdmin,
	PostComments,
	UpdateCommentStatus,
} from "../controllers/comments.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { parseId } from "../lib/parseId.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { rateLimit } from "../middleware/rateLimit.middleware.js";
import {
	updateCommentStatusSchema,
	userInputSchema,
} from "../schemas/comments.js";

const router = new Hono<AppEnv>();

// GET /comments - Obtener todos los comentarios (solo "published")
router.get("/", async (c) => {
	const result = await GetAllComments(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /comments/admin - todos los estados, incluido "pending". Protegido
// por JWT (docs/00-auditoria.md hallazgo 3) - registrado antes de
// "/:id" para que no lo intercepte como si "admin" fuera un id.
router.get("/admin", accessAuth, async (c) => {
	const result = await GetAllCommentsAdmin(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /comments/pending-count - globo de "pendientes" del menu del admin.
// Antes de "/:id" para que no lo tome por un id.
router.get("/pending-count", accessAuth, async (c) => {
	const pending = await CountPendingComments(c.get("db"));
	return c.json(
		{ success: true, data: { pending } } as ApiResponse<{ pending: number }>,
		200,
	);
});

// POST /comments - Crear nuevo comentario (con validación automática).
// Rate limit primero: es publico y sin auth de usuario real, el vector
// real del hackeo de 800 comentarios (docs/00-auditoria.md hallazgo 1).
router.post(
	"/",
	rateLimit({ limit: 5, windowMs: 60_000 }),
	zValidator("json", userInputSchema, zodErrorHook),
	async (c) => {
		const data = c.req.valid("json");

		const result = await PostComments(c.get("db"), data);
		return c.json(
			{
				success: true,
				data: result,
				message: "Comentario creado exitosamente",
			} as ApiResponse<typeof result>,
			201,
		);
	},
);

// PUT /comments/:id - aprobar/ocultar. Protegido por JWT.
router.put(
	"/:id",
	accessAuth,
	zValidator("json", updateCommentStatusSchema, zodErrorHook),
	async (c) => {
		const id = parseId(c.req.param("id"));

		const { status } = c.req.valid("json");
		const result = await UpdateCommentStatus(c.get("db"), id, status);
		if (!result) {
			throw new HTTPException(404, { message: "Comentario no encontrado" });
		}

		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "update",
			resource: "comments",
			resourceId: id,
			summary: `estado: ${status}`,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

// DELETE /comments/:id - borrado definitivo (el admin lo ofrece solo desde "Ocultos").
router.delete("/:id", accessAuth, async (c) => {
	const id = parseId(c.req.param("id"));
	const result = await DeleteComment(c.get("db"), id);
	if (!result) {
		throw new HTTPException(404, { message: "Comentario no encontrado" });
	}
	await auditLog({
		db: c.get("db"),
		adminEmail: adminEmail(c),
		action: "delete",
		resource: "comments",
		resourceId: id,
	});
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

export default router;
