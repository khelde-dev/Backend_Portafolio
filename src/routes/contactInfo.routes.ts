import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
	GetContactInfo,
	GetContactInfoAdmin,
	UpdateContactInfo,
} from "../controllers/contactInfo.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { splitExpected } from "../lib/optimistic.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { contactInfoInputSchema } from "../schemas/contactInfo.js";

const router = new Hono<AppEnv>();

// GET /contact-info - lectura publica del sitio (con el bearer de la app).
router.get("/", async (c) => {
	const result = await GetContactInfo(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /contact-info/admin - para el CMS, protegido por Cloudflare Access.
router.get("/admin", accessAuth, async (c) => {
	const result = await GetContactInfoAdmin(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// PUT /contact-info - sin :id: es un singleton, no hay POST ni DELETE.
router.put(
	"/",
	accessAuth,
	zValidator("json", contactInfoInputSchema, zodErrorHook),
	async (c) => {
		const { expected, data } = splitExpected(c.req.valid("json"));
		const result = await UpdateContactInfo(c.get("db"), data, expected);

		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "update",
			resource: "contact-info",
			resourceId: 1,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

export default router;
