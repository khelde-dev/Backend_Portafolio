/**
 * Lectura minima del encabezado de un WebP, sin decodificar la imagen.
 *
 * Sirve para NO confiar en la cabecera `Content-Type` ni en la extension: un
 * archivo solo se acepta si empieza como un WebP de verdad (`RIFF....WEBP`),
 * esta completo y sus dimensiones caen dentro del tope.
 *
 * Los tres formatos de WebP guardan el ancho y el alto en sitios distintos:
 *  - `VP8 ` (con perdida): 14 bits cada uno tras el codigo de inicio 9d 01 2a.
 *  - `VP8L` (sin perdida): 14 bits cada uno (menos 1) tras la firma 0x2f.
 *  - `VP8X` (extendido, con alfa o animacion): 24 bits cada uno (menos 1).
 */
export interface WebpInfo {
	width: number;
	height: number;
	format: "lossy" | "lossless" | "extended";
}

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
	String.fromCharCode(...bytes.subarray(start, end));

const u24 = (b: Uint8Array, i: number) =>
	b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32 = (b: Uint8Array, i: number) =>
	(b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** Devuelve las dimensiones, o `null` si NO es un WebP valido y completo. */
export const inspectWebp = (bytes: Uint8Array): WebpInfo | null => {
	// RIFF (4) + tamano (4) + WEBP (4) + chunk (4) + tamano del chunk (4) + datos.
	if (bytes.length < 30) return null;
	if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP")
		return null;
	// El tamano declarado debe caber: un archivo cortado se rechaza.
	if (u32(bytes, 4) + 8 > bytes.length) return null;

	const chunk = ascii(bytes, 12, 16);

	if (chunk === "VP8 ") {
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
			return null;
		const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
		const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
		return width > 0 && height > 0 ? { width, height, format: "lossy" } : null;
	}

	if (chunk === "VP8L") {
		if (bytes[20] !== 0x2f) return null;
		const bits = u32(bytes, 21);
		return {
			width: (bits & 0x3fff) + 1,
			height: ((bits >>> 14) & 0x3fff) + 1,
			format: "lossless",
		};
	}

	if (chunk === "VP8X") {
		return {
			width: u24(bytes, 24) + 1,
			height: u24(bytes, 27) + 1,
			format: "extended",
		};
	}

	return null;
};
