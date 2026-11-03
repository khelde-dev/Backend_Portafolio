/**
 * Reglas de las imagenes del CMS en R2 (docs del admin: plan/05-imagenes-r2.md).
 *
 * - Solo WebP: lo convierte el navegador antes de subir y aqui se verifica.
 * - La clave la genera el SERVIDOR (`<carpeta>/<uuid>.webp`): el cliente solo
 *   elige la carpeta. Nunca el nombre del archivo del usuario.
 * - Las claves heredadas (`/UPVM.webp`, `Backend_Task.webp`) siguen siendo
 *   validas para el sitio; aqui solo se comparan normalizadas (sin `/` inicial).
 */
export const MEDIA_AREAS = [
	"projects",
	"experience",
	"education",
	"about",
	"site",
] as const;
export type MediaArea = (typeof MEDIA_AREAS)[number];

/** Tope duro de una subida (el cliente ya la dejo mucho mas chica). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Tope de ancho y alto en pixeles. */
export const MAX_IMAGE_DIMENSION = 4096;

/** Cache "para siempre": la clave cambia si la imagen cambia. */
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export const isMediaArea = (value: unknown): value is MediaArea =>
	typeof value === "string" &&
	(MEDIA_AREAS as readonly string[]).includes(value);

export const newMediaKey = (area: MediaArea): string =>
	`${area}/${crypto.randomUUID()}.webp`;

/** `/UPVM.webp` y `UPVM.webp` son el mismo objeto. */
export const normalizeKey = (key: string): string => key.replace(/^\/+/, "");

export const publicUrl = (
	base: string | undefined,
	key: string,
): string | null =>
	base ? `${base.replace(/\/+$/, "")}/${normalizeKey(key)}` : null;

/** Una clave que se pide borrar no puede salirse del bucket ni parecer una URL. */
export const isSafeKey = (key: string): boolean =>
	key.length > 0 &&
	key.length <= 512 &&
	!key.startsWith("//") &&
	!key.includes("\\") &&
	!key.includes(":") &&
	!key.split("/").some((segment) => segment === ".." || segment === ".") &&
	![...key].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
