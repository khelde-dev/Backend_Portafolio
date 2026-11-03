import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	CreateExperience,
	DeleteExperience,
	GetAllExperiences,
	GetAllExperiencesAdmin,
	UpdateExperience,
} from "../controllers/experiences.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { registerOrderRoute } from "../lib/orderRoute.js";
import { parseId } from "../lib/parseId.js";
import { requireLocale } from "../lib/requireLocale.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import {
	experience,
	experienceAdminInputSchema,
} from "../schemas/experiences.js";

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
	const currentLocale = requireLocale(c);
	const result = await GetAllExperiences(c.get("db"), { currentLocale });
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /experiences/admin - para el CMS: incluye borradores y todas las traducciones.
// Protegido por Cloudflare Access; registrado antes de "/:id".
router.get("/admin", accessAuth, async (c) => {
	const result = await GetAllExperiencesAdmin(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// PUT /experiences/order - reordenar en lote ([{ id, sort_order }]). Antes de "/:id".
registerOrderRoute(router, {
	resource: "experiences",
	table: experience,
	idColumn: experience.experience_id,
	sortColumn: experience.sort_order,
	updatedColumn: experience.updated_at,
});

// POST /experiences - crear. Protegido por JWT.
router.post(
	"/",
	accessAuth,
	zValidator("json", experienceAdminInputSchema, zodErrorHook),
	async (c) => {
		const data = c.req.valid("json");
		const result = await CreateExperience(c.get("db"), data);

		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "create",
			resource: "experiences",
			resourceId: result.experience_id,
			summary: data.title_default,
		});

		return c.json(
			{
				success: true,
				data: result,
				message: "Experiencia creada",
			} as ApiResponse<typeof result>,
			201,
		);
	},
);

// PUT /experiences/:id - reemplazo completo (incluye traducciones).
router.put(
	"/:id",
	accessAuth,
	zValidator("json", experienceAdminInputSchema, zodErrorHook),
	async (c) => {
		const id = parseId(c.req.param("id"));

		const data = c.req.valid("json");
		const result = await UpdateExperience(c.get("db"), id, data);
		if (!result) {
			throw new HTTPException(404, { message: "Experiencia no encontrada" });
		}

		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "update",
			resource: "experiences",
			resourceId: id,
			summary: data.title_default,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

// DELETE /experiences/:id - cascada real a experience_translations
// (verificado: foreign_keys ON en esta conexion).
router.delete("/:id", accessAuth, async (c) => {
	const id = parseId(c.req.param("id"));

	const result = await DeleteExperience(c.get("db"), id);
	if (!result) {
		throw new HTTPException(404, { message: "Experiencia no encontrada" });
	}

	await auditLog({
		db: c.get("db"),
		adminEmail: adminEmail(c),
		action: "delete",
		resource: "experiences",
		resourceId: id,
		summary: result.title_default,
	});

	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

export default router;
