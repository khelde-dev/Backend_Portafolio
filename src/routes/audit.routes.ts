import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { listAudit } from "../lib/auditLog.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth } from "../middleware/access.middleware.js";
import { auditQuerySchema } from "../schemas/auditLog.js";

const router = new Hono<AppEnv>();

// GET /audit?limit= - historial del CMS, lo mas nuevo primero. Solo lectura.
router.get(
	"/",
	accessAuth,
	zValidator("query", auditQuerySchema, zodErrorHook),
	async (c) => {
		const { limit } = c.req.valid("query");
		const result = await listAudit(c.get("db"), limit);
		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

export default router;
