import { z } from "zod";

/**
 * URL absoluta http(s). `z.url()` solo exige que sea parseable: dejaria pasar
 * `javascript:`, `data:` o `file:`, que acaban en un `href` del sitio (XSS).
 */
export const httpUrl = (message = "URL invalida") =>
	z.url({ protocol: /^https?$/, error: message });

const BACKSLASH = String.fromCharCode(92);

const hasTraversal = (key: string) =>
	key.split("/").some((segment) => segment === ".." || segment === ".");

const hasControlChars = (key: string) =>
	[...key].some((ch) => {
		const code = ch.charCodeAt(0);
		return code < 0x20 || code === 0x7f;
	});

/**
 * Clave de objeto en R2 (`/UPVM.webp` o `projects/abc.webp`; el sitio la pega a
 * PUBLIC_MEDIA_URL). Sin `..`, sin esquema (`https:`), sin `//` inicial (URL
 * relativa al protocolo), sin barras invertidas ni caracteres de control: asi
 * una clave nunca se interpreta como URL externa ni sale del bucket.
 */
export const r2Key = (message = "Clave de imagen invalida") =>
	z
		.string()
		.min(1, "La imagen es requerida")
		.max(512, message)
		.refine(
			(key) =>
				!key.startsWith("//") &&
				!key.includes(BACKSLASH) &&
				!key.includes(":") &&
				!hasTraversal(key) &&
				!hasControlChars(key),
			message,
		);
