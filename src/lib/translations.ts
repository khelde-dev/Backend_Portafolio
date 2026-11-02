import type { LOCALES } from "./constants.js";

/**
 * Las traducciones viven en la MISMA fila, en una columna JSON
 * (`{ "en": { ... }, "fr": { ... } }`): una sola escritura por recurso,
 * atomica sin transacciones (D1 no las tiene) y sin joins al leer.
 * Lo que no esta traducido cae al valor `*_default`.
 */
export type TranslationMap<T> = Partial<
	Record<(typeof LOCALES)[number], Partial<T>>
>;

export const parseJson = <T>(raw: unknown, fallback: T): T => {
	if (typeof raw !== "string" || raw === "") return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
};

/** [{ locale: "en", title: "x" }] -> { en: { title: "x" } } */
export const toTranslationMap = <T extends { locale: string }>(
	list: T[],
): TranslationMap<Omit<T, "locale">> =>
	Object.fromEntries(
		list.map(({ locale, ...rest }) => [locale, rest]),
	) as TranslationMap<Omit<T, "locale">>;

/** Traduccion del idioma pedido, sin los valores vacios (para no pisar el default). */
export const translationFor = <T extends object>(
	raw: unknown,
	locale: string,
): Partial<T> => {
	const map = parseJson<Record<string, Partial<T>>>(raw, {});
	const entry = map[locale] ?? {};
	return Object.fromEntries(
		Object.entries(entry).filter(
			([, v]) => v !== null && v !== undefined && v !== "",
		),
	) as Partial<T>;
};

export const hasDuplicateLocales = (list: { locale: string }[]): boolean =>
	new Set(list.map((t) => t.locale)).size !== list.length;
