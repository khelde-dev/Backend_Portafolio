/** WebP de mentira para las pruebas (solo el encabezado que lee inspectWebp). */
/** WebP sin perdida de 1x1 px (el mas chico que existe). */
export const TINY_WEBP = Uint8Array.from(
	atob("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="),
	(c) => c.charCodeAt(0),
);

export const le = (value: number, bytes: number) =>
	Array.from({ length: bytes }, (_, i) => (value >>> (8 * i)) & 0xff);
export const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** WebP extendido (VP8X) del tamano indicado: solo el encabezado, suficiente para medirlo. */
export const vp8x = (width: number, height: number) => {
	const body = [
		...text("WEBP"),
		...text("VP8X"),
		...le(10, 4),
		0,
		0,
		0,
		0,
		...le(width - 1, 3),
		...le(height - 1, 3),
	];
	return Uint8Array.from([...text("RIFF"), ...le(body.length, 4), ...body]);
};

export const vp8 = (width: number, height: number) => {
	const body = [
		...text("WEBP"),
		...text("VP8 "),
		...le(10, 4),
		0,
		0,
		0,
		0x9d,
		0x01,
		0x2a,
		...le(width, 2),
		...le(height, 2),
	];
	return Uint8Array.from([...text("RIFF"), ...le(body.length, 4), ...body]);
};
