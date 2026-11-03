import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
	GetAbout,
	GetAboutAdmin,
	UpdateAbout,
} from "../controllers/about.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { splitExpected } from "../lib/optimistic.js";
import { requireLocale } from "../lib/requireLocale.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { aboutAdminInputSchema } from "../schemas/about.js";

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
	const currentLocale = requireLocale(c);
	const result = await GetAbout(c.get("db"), { currentLocale });
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /about/admin - para el CMS: todas las traducciones. Protegido por Cloudflare Access.
router.get("/admin", accessAuth, async (c) => {
	const result = await GetAboutAdmin(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// PUT /about - sin :id en la URL: es un singleton (ver schemas/about.ts),
// no tiene sentido POST (crear otro) ni DELETE (borrar el unico).
router.put(
	"/",
	accessAuth,
	zValidator("json", aboutAdminInputSchema, zodErrorHook),
	async (c) => {
		const { expected, data } = splitExpected(c.req.valid("json"));
		const result = await UpdateAbout(c.get("db"), data, expected);

		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "update",
			resource: "about",
			resourceId: 1,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

export default router;
