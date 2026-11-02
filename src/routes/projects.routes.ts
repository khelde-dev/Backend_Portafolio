import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	CreateProject,
	DeleteProject,
	GetAllProjects,
	GetAllProjectsAdmin,
	UpdateProject,
} from "../controllers/projects.controllers.js";
import type { AppEnv } from "../env.js";
import type { ApiResponse } from "../interfaces/interfaces.js";
import { auditLog } from "../lib/auditLog.js";
import { parseId } from "../lib/parseId.js";
import { requireLocale } from "../lib/requireLocale.js";
import { zodErrorHook } from "../lib/zodErrorHook.js";
import { accessAuth, adminEmail } from "../middleware/access.middleware.js";
import { projectAdminInputSchema } from "../schemas/projects.js";

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
	const currentLocale = requireLocale(c);
	const result = await GetAllProjects(c.get("db"), { currentLocale });
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// GET /projects/admin - para el CMS: incluye borradores y todas las traducciones.
// Protegido por Cloudflare Access; registrado antes de "/:id".
router.get("/admin", accessAuth, async (c) => {
	const result = await GetAllProjectsAdmin(c.get("db"));
	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

// POST /projects - crear. Protegido por JWT (Fase 4b, docs/04-hono-projects-experiences-crud.md).
router.post(
	"/",
	accessAuth,
	zValidator("json", projectAdminInputSchema, zodErrorHook),
	async (c) => {
		const data = c.req.valid("json");
		const result = await CreateProject(c.get("db"), data);

		auditLog({
			adminEmail: adminEmail(c),
			action: "create",
			resource: "projects",
			resourceId: result.project_id,
		});

		return c.json(
			{
				success: true,
				data: result,
				message: "Proyecto creado",
			} as ApiResponse<typeof result>,
			201,
		);
	},
);

// PUT /projects/:id - reemplazo completo (incluye traducciones).
router.put(
	"/:id",
	accessAuth,
	zValidator("json", projectAdminInputSchema, zodErrorHook),
	async (c) => {
		const id = parseId(c.req.param("id"));

		const data = c.req.valid("json");
		const result = await UpdateProject(c.get("db"), id, data);
		if (!result) {
			throw new HTTPException(404, { message: "Proyecto no encontrado" });
		}

		auditLog({
			adminEmail: adminEmail(c),
			action: "update",
			resource: "projects",
			resourceId: id,
		});

		return c.json(
			{ success: true, data: result } as ApiResponse<typeof result>,
			200,
		);
	},
);

// DELETE /projects/:id - cascada real a project_translations (verificado:
// foreign_keys ON en esta conexion).
router.delete("/:id", accessAuth, async (c) => {
	const id = parseId(c.req.param("id"));

	const result = await DeleteProject(c.get("db"), id);
	if (!result) {
		throw new HTTPException(404, { message: "Proyecto no encontrado" });
	}

	auditLog({
		adminEmail: adminEmail(c),
		action: "delete",
		resource: "projects",
		resourceId: id,
	});

	return c.json(
		{ success: true, data: result } as ApiResponse<typeof result>,
		200,
	);
});

export default router;
