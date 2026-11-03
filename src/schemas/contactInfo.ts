import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { timestamps } from "./common.js";

/**
 * Datos de contacto del sitio (GitHub, LinkedIn, telefono y correo). Singleton:
 * siempre id = 1, igual que `about`. No se traduce: son los mismos en todos los
 * idiomas. El enlace de WhatsApp no se guarda: se arma con el telefono.
 */
export const contactInfo = sqliteTable("contact_info", {
	contact_id: int("id").primaryKey().notNull(),
	github_url: text("github_url").notNull(),
	linkedin_url: text("linkedin_url").notNull(),
	linkedin_name: text("linkedin_name").notNull(),
	phone: text("phone").notNull(),
	email: text("email").notNull(),
	...timestamps,
});

/**
 * URL https de un dominio concreto (o uno de sus subdominios). Un enlace de
 * "GitHub" que apunta a otro sitio, o con `javascript:`, acabaria en un `href`
 * publico: por eso el dominio se valida aqui y no solo que sea una URL.
 */
const siteUrl = (domain: string, label: string) =>
	z
		.string()
		.trim()
		.max(300, `El enlace de ${label} es demasiado largo`)
		.refine((value) => {
			try {
				const url = new URL(value);
				return (
					url.protocol === "https:" &&
					(url.hostname === domain || url.hostname.endsWith(`.${domain}`))
				);
			} catch {
				return false;
			}
		}, `El enlace de ${label} debe ser una URL https de ${domain}`);

const digits = (phone: string) => phone.replace(/\D/g, "");

export const contactInfoInputSchema = z.object({
	// El `updated_at` que leyo el formulario: si la fila ya cambio, el PUT da 409.
	updated_at: z.string().max(40).optional(),
	github_url: siteUrl("github.com", "GitHub"),
	linkedin_url: siteUrl("linkedin.com", "LinkedIn"),
	linkedin_name: z
		.string()
		.trim()
		.min(1, "El nombre de LinkedIn es requerido")
		.max(100, "El nombre de LinkedIn admite hasta 100 caracteres"),
	phone: z
		.string()
		.trim()
		.max(30, "El telefono es demasiado largo")
		.regex(
			/^\+[\d\s().-]+$/,
			"El telefono empieza con + y la lada del pais, por ejemplo +52 55 1190 9105",
		)
		.refine(
			(phone) => digits(phone).length >= 8 && digits(phone).length <= 15,
			"El telefono debe tener entre 8 y 15 digitos",
		),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.max(254, "El correo es demasiado largo")
		.pipe(z.email("El correo no es valido")),
});

export type ContactInfoInput = z.infer<typeof contactInfoInputSchema>;
