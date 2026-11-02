import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	CreateEducation,
	DeleteEducation,
	GetAllEducation,
	GetAllEducationAdmin,
	UpdateEducation,
} from "../controllers/education.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { parseId } from "../lib/parseId.js";
import { requireLocale } from "../lib/requireLocale.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { educationAdminInputSchema } from "../schemas/education.js";

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
	const currentLocale = requireLocale(c);
	const result = await GetAllEducation(c.get("db"), { currentLocale });
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /education/admin - para el CMS: incluye borradores y todas las traducciones.
// Protegido por Cloudflare Access; registrado antes de "/:id".
router.get("/admin", accessAuth, async (c) => {
	const result = await GetAllEducationAdmin(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// POST /education - crear. Protegido por JWT.
router.post(
	"/",
	accessAuth,
	zValidator("json", educationAdminInputSchema, zodErrorHook),
	async (c) => {
		const data = c.req.valid("json");
		const result = await CreateEducation(c.get("db"), data);

		auditLog({
			adminEmail: adminEmail(c),
			action: "create",
			resource: "education",
			resourceId: result.education_id,
		});

		return c.json(
			{
				success: true,
				data: result,
				message: "Educacion creada",
			} as ApiResponse<typeof result>,
			201,
		);
	},
);

// PUT /education/:id - reemplazo completo (incluye traducciones).
router.put(
	"/:id",
	accessAuth,
	zValidator("json", educationAdminInputSchema, zodErrorHook),
	async (c) => {
		const id = parseId(c.req.param("id"));

		const data = c.req.valid("json");
		const result = await UpdateEducation(c.get("db"), id, data);
		if (!result) {
			throw new HTTPException(404, { message: "Educacion no encontrada" });
		}

		auditLog({
			adminEmail: adminEmail(c),
			action: "update",
			resource: "education",
			resourceId: id,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

// DELETE /education/:id - cascada real a education_translations
// (verificado en Fase 4b: foreign_keys ON en esta conexion).
router.delete("/:id", accessAuth, async (c) => {
	const id = parseId(c.req.param("id"));

	const result = await DeleteEducation(c.get("db"), id);
	if (!result) {
		throw new HTTPException(404, { message: "Educacion no encontrada" });
	}

	auditLog({
		adminEmail: adminEmail(c),
		action: "delete",
		resource: "education",
		resourceId: id,
	});

	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

export default router;
