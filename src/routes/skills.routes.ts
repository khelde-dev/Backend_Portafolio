import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	CreateSkill,
	DeleteSkill,
	GetAllSkills,
	GetAllSkillsAdmin,
	UpdateSkill,
} from "../controllers/skills.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { registerOrderRoute } from "../lib/orderRoute.js";
import { parseId } from "../lib/parseId.js";
import { requireLocale } from "../lib/requireLocale.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { skillAdminInputSchema, skills } from "../schemas/skills.js";

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
	const currentLocale = requireLocale(c);
	const result = await GetAllSkills(c.get("db"), { currentLocale });
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /skills/admin - para el CMS: incluye borradores y todas las traducciones.
// Protegido por Cloudflare Access; registrado antes de "/:id".
router.get("/admin", accessAuth, async (c) => {
	const result = await GetAllSkillsAdmin(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// PUT /skills/order - reordenar en lote ([{ id, sort_order }]). Antes de "/:id".
registerOrderRoute(router, {
	resource: "skills",
	table: skills,
	idColumn: skills.skill_id,
	sortColumn: skills.sort_order,
	updatedColumn: skills.updated_at,
});

// POST /skills - crear. Protegido por JWT.
router.post(
	"/",
	accessAuth,
	zValidator("json", skillAdminInputSchema, zodErrorHook),
	async (c) => {
		const data = c.req.valid("json");
		const result = await CreateSkill(c.get("db"), data);

		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "create",
			resource: "skills",
			resourceId: result.skill_id,
			summary: data.title_default,
		});

		return c.json(
			{
				success: true,
				data: result,
				message: "Habilidad creada",
			} as ApiResponse<typeof result>,
			201,
		);
	},
);

// PUT /skills/:id - reemplazo completo (incluye traducciones).
router.put(
	"/:id",
	accessAuth,
	zValidator("json", skillAdminInputSchema, zodErrorHook),
	async (c) => {
		const id = parseId(c.req.param("id"));

		const data = c.req.valid("json");
		const result = await UpdateSkill(c.get("db"), id, data);
		if (!result) {
			throw new HTTPException(404, { message: "Habilidad no encontrada" });
		}

		await auditLog({
			db: c.get("db"),
			adminEmail: adminEmail(c),
			action: "update",
			resource: "skills",
			resourceId: id,
			summary: data.title_default,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

// DELETE /skills/:id - cascada real a skill_translations (verificado en
// Fase 4b: foreign_keys ON en esta conexion).
router.delete("/:id", accessAuth, async (c) => {
	const id = parseId(c.req.param("id"));

	const result = await DeleteSkill(c.get("db"), id);
	if (!result) {
		throw new HTTPException(404, { message: "Habilidad no encontrada" });
	}

	await auditLog({
		db: c.get("db"),
		adminEmail: adminEmail(c),
		action: "delete",
		resource: "skills",
		resourceId: id,
		summary: result.title_default,
	});

	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

export default router;
