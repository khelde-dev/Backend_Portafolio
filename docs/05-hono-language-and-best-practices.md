# `hono/language` + revisión contra la guía de best practices de Hono

Pedido explícito: sumar el [middleware de detección de idioma](https://hono.dev/docs/middleware/builtin/language)
y revisar la [guía de best practices](https://hono.dev/docs/guides/best-practices)
de Hono contra este proyecto.

## `hono/language`

### Diseño

`languageDetector` se registra **global** (`src/index.ts`), configurado
para no cambiar el contrato existente con Astro:

```ts
languageDetector({
	order: ["querystring"],
	lookupQueryString: "currentLocale", // mismo nombre que ya usaba /projects y /experiences
	supportedLanguages: [...LOCALES],   // ["en", "es", "fr"]
	fallbackLanguage: "es",             // mismo default que DEFAULT_LOCALE en Portafolio
	caches: false,                      // API sin estado, no hace falta cookie de idioma
});
```

`order: ["querystring"]` — a propósito **no** se activa detección por
cookie/header. Esta API la consume un solo cliente real (el proxy de
Astro), que siempre manda `?currentLocale=` explícito; agregar detección
por `Accept-Language` sumaría una fuente de verdad más sin que nada la
necesite hoy.

`src/lib/requireLocale.ts` (nuevo, usado en `projects.routes.ts` y
`experiences.routes.ts`) reemplaza la validación manual
(`LOCALES.includes(currentLocale)`, exacta y sensible a mayúsculas) por:

```ts
export const requireLocale = <V extends LanguageVariables>(c: Context<{ Variables: V }>): string => {
	if (!c.req.query("currentLocale")) {
		throw new HTTPException(400, { message: "Falta el parámetro currentLocale" });
	}
	return c.get("language");
};
```

### Cambio de comportamiento intencional (documentado, con tests actualizados)

- **`currentLocale` ausente del todo → sigue siendo 400.** Es el bug real
  que ya pasó una vez (el proxy de Astro olvidó reenviarlo en
  escrituras admin, corregido hace tiempo) — perder ese error temprano
  sería un paso atrás.
- **`currentLocale` presente pero no exacto → ya NO es 400.** Antes
  `?currentLocale=es-MX` o `?currentLocale=ES` se rechazaban (comparación
  exacta). Ahora `hono/language` normaliza por truncamiento progresivo
  (`es-MX` → prueba `es-mx`, no matchea, trunca a `es`, matchea) y es
  case-insensitive — y si no matchea nada, cae al `fallbackLanguage`
  (`es`) en vez de cortar la request. Es el comportamiento estándar de
  negociación de idioma (similar a `Accept-Language`), más permisivo que
  la comparación exacta que había antes.

Verificado en vivo contra el servidor real:
`?currentLocale=es-MX` devuelve exactamente el mismo contenido que
`?currentLocale=es` (confirmado byte a byte, misma fila). `?currentLocale=xx`
(no reconocible) ahora da `200` con el fallback, ya no `400`.

`tests/experiences.test.ts`/`tests/projects.test.ts` actualizados: el
test de "400 con locale inválido" se reemplazó por uno que confirma el
`200` con fallback — no se borró cobertura, se corrigió para reflejar el
contrato nuevo.

## Revisión contra la guía de best practices

| Práctica | Estado en este repo |
|---|---|
| No armar controllers al estilo Rails (`const handler = (c) => {...}; app.get(path, handler)`, pierde la inferencia del path param) | **Ya se cumplía** — los handlers de ruta son siempre funciones inline en cada `*.routes.ts`; los "controllers" de este repo (`comments.controllers.ts`, etc.) son funciones de acceso a datos con argumentos tipados normales (`UpdateCommentStatus(id, status)`), no toman `Context` — no son el anti-patrón que la guía describe. |
| `factory.createHandlers()` para código estilo controller | No aplica — no hay controllers que tomen `Context` en este repo (ver arriba). |
| `app.route()` para apps grandes + exportar el tipo de la app para RPC | `app.route()` ya se usaba desde la Fase 1 para los 5 routers. **Agregado**: `export type AppType = typeof app` en `src/index.ts` — Portafolio hoy consume esta API con `axios` (no con `hono/client`), así que esto no cambia nada todavía, pero deja la puerta abierta a un cliente RPC tipado sin tener que tocar este archivo después. |
| No usar handlers `HEAD` dedicados (nunca se llaman si ya existe un handler `GET` para la misma ruta) | No aplica — este repo nunca registró un `app.head(...)`. |

## Verificación

`bun test`: 50 tests en verde (2 nuevos, cubren el cambio de
comportamiento de `currentLocale`). `bunx tsc --noEmit`/`bunx biome check`:
limpio. Verificación manual contra Turso real descrita arriba.
