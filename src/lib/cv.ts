/**
 * Reglas del curriculum (PDF) que se sube desde el CMS a R2. Es un solo archivo:
 * subir otro reemplaza al anterior.
 *
 * - Solo PDF: el servidor mira el archivo, no confia en la cabecera.
 * - La clave la genera el SERVIDOR (`cv/CV-Erick-Gonzalez-<id>.pdf`).
 * - Se guarda con `Content-Disposition: inline`: el navegador lo abre y lo muestra,
 *   y si lo descargan conserva un nombre legible.
 */
export const CV_PREFIX = "cv/";

/** Tope duro de una subida. */
export const MAX_CV_BYTES = 5 * 1024 * 1024;

/** Nombre con el que lo ve quien lo descarga. */
export const CV_FILENAME = "CV-Erick-Gonzalez.pdf";
export const CV_CONTENT_DISPOSITION = `inline; filename="${CV_FILENAME}"`;

/** La clave cambia en cada subida, asi que se puede cachear "para siempre". */
export const CV_CACHE_CONTROL = "public, max-age=31536000, immutable";

export const newCvKey = (): string =>
	`${CV_PREFIX}CV-Erick-Gonzalez-${crypto.randomUUID().slice(0, 8)}.pdf`;

/** Un PDF empieza con `%PDF-`; lo demas (HTML, ZIP, imagenes) se rechaza. */
export const looksLikePdf = (bytes: Uint8Array): boolean => {
	if (bytes.length < 8) return false;
	const head = "%PDF-";
	for (let i = 0; i < head.length; i++) {
		if (bytes[i] !== head.charCodeAt(i)) return false;
	}
	return true;
};

/** Claves del curriculum: nunca se tratan como imagenes de la biblioteca. */
export const isCvKey = (key: string): boolean =>
	key.replace(/^\/+/, "").startsWith(CV_PREFIX);
