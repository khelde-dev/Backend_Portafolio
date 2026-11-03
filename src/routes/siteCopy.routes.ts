import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
	GetSiteCopy,
	GetSiteCopyAdmin,
	UpdateSiteCopy,
} from "../controllers/siteCopy.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { splitExpected } from "../lib/optimistic.js";
import { requireLocale } from "../lib/requireLocale.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { siteCopyAdminInputSchema } from "../schemas/siteCopy.js";

const router = new Hono<AppEnv>();

// GET /site-copy?currentLocale= - lectura publica del sitio (con el bearer de la app).
router.get("/", async (c) => {
	const currentLocale = requireLocale(c);
	const result = await GetSiteCopy(c.get("db"), { currentLocale });
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /site-copy/admin - para el CMS: todas las traducciones.
router.get("/admin", accessAuth, async (c) => {
	const result = await GetSiteCopyAdmin(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// PUT /site-copy - sin :id: es un singleton, no hay POST ni DELETE.
router.put(
	"/",
	accessAuth,
	zValidator("json", siteCopyAdminInputSchema, zodErrorHook),
	async (c) => {
		const { expected, data } = splitExpected(c.req.valid("json"));
		const result = await UpdateSiteCopy(c.get("db"), data, expected);

		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "update",
			resource: "site-copy",
			resourceId: 1,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

export default router;
