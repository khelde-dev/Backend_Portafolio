/**
 * Log de auditoria para escrituras admin - quien, que recurso, que
 * accion, cuando. Checklist de seguridad de docs/03-diseno-api.md
 * (Portafolio): "Logs de auditoria basicos en escrituras del admin
 * (aunque sea un solo usuario, sirve para depurar)" - quedaba pendiente
 * desde la Fase 1, se cierra aqui (OWASP A09: Security Logging and
 * Monitoring Failures).
 *
 * A consola, mismo sink que el resto de los logs de esta app (ver
 * logger.middleware.ts - Vercel Functions lo captura nativamente, el
 * filesystem es de solo lectura en produccion).
 */
export const auditLog = (params: {
	adminEmail: string;
	action: "create" | "update" | "delete";
	resource: string;
	resourceId: number | string;
}): void => {
	const { adminEmail, action, resource, resourceId } = params;
	console.log(
		`[AUDIT] [${new Date().toISOString()}] ${adminEmail} ${action} ${resource}/${resourceId}`,
	);
};
