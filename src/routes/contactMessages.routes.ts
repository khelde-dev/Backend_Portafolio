import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	CountUnreadContactMessages,
	DeleteContactMessage,
	GetAllContactMessages,
	PostContactMessage,
	UpdateContactMessageStatus,
} from "../controllers/contactMessages.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { parseId } from "../lib/parseId.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { rateLimit } from "../middleware/rateLimit.middleware.js";
import {
	contactMessageUserInputSchema,
	listContactMessagesQuerySchema,
	updateContactMessageStatusSchema,
} from "../schemas/contactMessages.js";

const router = new Hono<AppEnv>();

// GET /contact-messages - bandeja de entrada del admin (Cloudflare Access).
// ?status=unread|read|replied filtra; sin parametro devuelve todos.
router.get(
	"/",
	accessAuth,
	zValidator("query", listContactMessagesQuerySchema, zodErrorHook),
	async (c) => {
		const { status } = c.req.valid("query");
		const result = await GetAllContactMessages(c.get("db"), status);
		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

// GET /contact-messages/unread-count - globo de "sin leer" del menu.
router.get("/unread-count", accessAuth, async (c) => {
	const unread = await CountUnreadContactMessages(c.get("db"));
	return c.json(
		{ success: true, data: { unread } } as ApiResponse<{ unread: number }>,
		200,
	);
});

// POST /contact-messages - reemplaza al viejo POST /tlgrm. A diferencia
// de aquel, valida con Zod de verdad (el viejo casteaba a mano) y no
// depende de un servicio externo (Telegram) para "existir" - el mensaje
// queda en Turso pase lo que pase con cualquier integracion externa.
router.post(
	"/",
	rateLimit({ limit: 5, windowMs: 60_000 }),
	zValidator("json", contactMessageUserInputSchema, zodErrorHook),
	async (c) => {
		const data = c.req.valid("json");
		const result = await PostContactMessage(c.get("db"), data);
		return c.json(
			{
				success: true,
				data: result,
				message: "Mensaje enviado exitosamente",
			} as ApiResponse<typeof result>,
			201,
		);
	},
);

// PUT /contact-messages/:id - marcar leido/respondido. Protegido por JWT.
router.put(
	"/:id",
	accessAuth,
	zValidator("json", updateContactMessageStatusSchema, zodErrorHook),
	async (c) => {
		const id = parseId(c.req.param("id"));

		const { status } = c.req.valid("json");
		const result = await UpdateContactMessageStatus(c.get("db"), id, status);
		if (!result) {
			throw new HTTPException(404, { message: "Mensaje no encontrado" });
		}

		auditLog({
			adminEmail: adminEmail(c),
			action: "update",
			resource: "contact-messages",
			resourceId: id,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

// DELETE /contact-messages/:id - borrar (spam).
router.delete("/:id", accessAuth, async (c) => {
	const id = parseId(c.req.param("id"));

	const result = await DeleteContactMessage(c.get("db"), id);
	if (!result) {
		throw new HTTPException(404, { message: "Mensaje no encontrado" });
	}

	auditLog({
		adminEmail: adminEmail(c),
		action: "delete",
		resource: "contact-messages",
		resourceId: id,
	});

	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

export default router;
