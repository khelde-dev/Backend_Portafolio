/**
 * Drizzle envuelve el error del driver ("Failed query: ...") y deja el
 * original en `cause`; D1 a su vez lo envuelve otra vez. Hay que recorrer la
 * cadena para encontrar el "UNIQUE constraint failed" real.
 */
export const isUniqueViolation = (err: unknown): boolean => {
	for (
		let current: unknown = err, depth = 0;
		current instanceof Error && depth < 5;
		current = current.cause, depth++
	) {
		if (/UNIQUE constraint failed/i.test(current.message)) return true;
	}
	return false;
};
