# Auditoría y hardening — Fase 1

Historial de hallazgos y decisiones para este repo (`Backend_Portafolio`),
mismo espíritu que `docs/considerations/` en el repo Portafolio: cada
veredicto está verificado contra el código real y, donde fue posible,
contra el servidor corriendo de verdad (`bun run --watch src/index.ts` +
`curl`), no solo leído. Este documento es el punto de partida de
`docs/TODO.md` §2 y §5 del repo Portafolio — la Fase 1 de ese plan.

## Contexto

Pedido explícito: auditar y endurecer este backend (malas prácticas,
huecos de seguridad, testing con las herramientas de Hono, `bun audit`),
documentar todo aquí, y resolver — ya no como decisión abierta — el
reemplazo del módulo de Telegram por un centro de mensajes en el admin,
más una cola de moderación para comentarios nuevos (ver Fase 3 más abajo,
y el plan completo en `docs/03-diseno-api.md` /
`docs/04-migracion-datos.md` del repo Portafolio).

## Hallazgos (verificados, no supuestos)

### 1. Causa raíz real del hackeo de ~800 comentarios

**No era el `API_BASE_PATH`** (hallazgo 2). Era que
`src/pages/api/[resource].ts` en Portafolio (el proxy público hacia este
backend) exponía `POST /api/comments` sin rate-limit, sin CAPTCHA y sin
cola de moderación — cualquiera podía scriptear el POST directo,
mismo-origen, sin necesitar el bearer token (Astro lo agrega
server-side). `src/lib/rateLimit.ts` (Portafolio) existía pero solo
protegía `/api/admin/login`, nunca se conectó a este endpoint público.

**Resuelto en esta fase, del lado de Hono**: `POST /comments` y
`POST /tlgrm` ahora tienen su propio rate limit (`rateLimit.middleware.ts`,
5 requests/60s por IP+ruta) — así, aunque algún día la URL/token se
filtren y alguien le pegue directo a este backend sin pasar por Astro,
sigue habiendo un techo. **Pendiente, del lado de Portafolio** (fuera del
alcance de este repo): conectar `src/lib/rateLimit.ts` al POST público de
`[resource].ts`, y mover comentarios nuevos a moderación (Fase 3 abajo) en
vez de publicarlos en vivo — eso es lo que de verdad cierra el vector.

Verificado en vivo: 5 POSTs seguidos con la misma IP simulada (header
`X-Forwarded-For`) devuelven 400 (validación), el 6to devuelve 429.

### 2. `API_BASE_PATH` como pseudo-secreto en la URL

El basePath (`/${process.env.API_BASE_PATH}`, un UUID) se trataba como si
fuera parte de la autenticación. No lo era: aparecía en texto plano en
cada línea de `src/logs/app.log` en cada request (confirmado leyendo el
archivo), en cualquier Network tab, y en cualquier proxy/CDN intermedio.
La seguridad real siempre fue el bearer token — el basePath solo agregaba
una ilusión de "URL secreta" sin aportar nada, exactamente la "URL
pésima" que se mencionó.

**Resuelto**: basePath fijo `/api`, informativo, no secreto — documentado
como tal en `src/index.ts`. La seguridad real sigue viviendo en el bearer
token + el rate limit del hallazgo 1.

**Efecto colateral, coordinado con el repo Portafolio**: `VITE_API_URL`
apunta a `<host>/<uuid>`, tiene que pasar a `<host>/api`. Ya actualizado en
el `.env` local de Portafolio para seguir probando en local. **Pendiente,
fuera de alcance de git**: actualizar `VITE_API_URL` en el dashboard de
Vercel del proyecto Portafolio (producción) a
`https://backend-portafolio-opal.vercel.app/api` antes de que este PR
llegue a producción — si no, el sitio en vivo pierde la conexión con el
backend.

### 3. Un solo `API_TOKEN` estático protege lectura y escritura por igual

Ya diagnosticado con solución propuesta en `docs/03-diseno-api.md`
(Portafolio): JWT de sesión admin de corta duración para escrituras
admin, el token fijo se queda solo para lecturas públicas. **Resuelto en
la Fase 4a** — ver [`03-hono-admin-auth.md`](03-hono-admin-auth.md):
tabla `users` real, `POST /auth/login`, JWT (`hono/jwt`, `HS256`)
aplicado a las rutas admin de `comments`/`contact_messages`. El CRUD de
`projects`/`experiences` queda para la Fase 4b, y la conexión del lado de
Astro (login real, ya no `ADMIN_PASSWORD`) para la Fase 4c.

### 4. `POST /tlgrm` sin validación Zod, interpola sin escapar en Markdown

Casteo manual (`Number(data.phone ?? 0)`), inconsistente con el resto del
código (`@hono/zod-validator` en `comments.routes.ts`). Interpola
`moreInformation` sin escapar en un mensaje de Telegram Markdown
(injection de formato). **No se arregla en el camino** — el módulo entero
se elimina en la Fase 3 (decisión ya tomada, no es una opción abierta).
Mientras sigue vivo, se le agregó el mismo rate limit que a `/comments`
(hallazgo 1).

### 5. `PostComments` hacía `SELECT *` completo solo para contar filas

`db.select().from(comments)` traía la tabla completa para calcular
`existing.length % 2` y alternar `direction` — un N+1 real que se agrava
justo bajo flood (el escenario del hackeo).

**Resuelto**: `db.select({ value: count() }).from(comments)` — un
`count()` agregado de Drizzle en vez de traer todas las filas. Ver
[`src/controllers/comments.controllers.ts`](../src/controllers/comments.controllers.ts).

### 6. Sin rate limiting en Hono mismo

Ya lo marcaba `docs/03-diseno-api.md` (Portafolio) como pendiente: si la
URL/token se filtran, un atacante directo a Hono (sin pasar por Astro) no
tenía ningún techo de volumen. **Resuelto** junto con el hallazgo 1
(`rateLimit.middleware.ts`, aplicado en `comments.routes.ts` y
`telegram.routes.ts`).

### 7. Cero tests

**Resuelto**: `tests/app.test.ts`, `bun test` (helper de testing nativo de
Bun — ver sección "Testing" abajo, incluye por qué no se usó
`testClient` de `hono/testing`). 15 tests, cubren: health check público,
bearer auth (401 sin token, 401 con token incorrecto, 200 con el
correcto), shape de respuesta de `GET /comments`, validación Zod de
`POST /comments` (shape normalizado, ver hallazgo 9), `count()` alternando
`direction`, rate limit disparando en `/comments` y `/tlgrm` (5
permitidos, el 6to en 429), validación de `currentLocale` en
`experiences`/`projects`, y que `POST /tlgrm` llama a la API de Telegram
**exactamente una vez** con `fetch` mockeado (cero mensajes reales
enviados durante los tests).

### 8. `package.json` sin campo `"version"`

Imposible alinear tags con un número publicado. **Resuelto**:
`"version": "0.1.0"` — primer tag real de este repo con versión
sincronizada. Aprovechado también para corregir `"name": "hono"` (el
nombre del paquete era literal el del framework, no el del proyecto) a
`"backend-portafolio"`, y agregar `"engines": { "bun": ">=1.3.0" }`.

### 9. Respuesta de error de Zod sin normalizar

`@hono/zod-validator` por default devuelve el `ZodError` crudo
(`{success:false, error:{name,message,...}}`) — inconsistente con el
shape `ApiResponse` que usa el resto de la API, y expone la forma interna
del schema. **Resuelto**: hook de error en `zValidator` de
`comments.routes.ts` normaliza a `{success:false, message, errors}`.
Verificado en vivo con `curl` antes/después del fix.

### 10. Logs a archivo que nunca funcionaron en producción

`errorHandler`/`customLogger` escribían con `fs.promises.appendFile` a
`src/logs/*.log` (ruta relativa al repo). Este backend corre como función
serverless en Vercel (confirmado: `.vercel/project.json` enlazado a un
proyecto real `backend-portafolio`, sin `server.listen` propio en el
código) — el filesystem ahí es de solo lectura en producción. El `catch`
silencioso de cada escritura escondía que esto **nunca funcionó en
producción**, solo en local. Los logs de auditoría que pedía el checklist
de `docs/03-diseno-api.md` ("quién, qué recurso, cuándo") jamás existieron
fuera de la máquina de desarrollo.

**Resuelto**: logs a `console.log`/`console.error`/`console.warn` — es lo
que Vercel Functions captura nativamente en su dashboard, y es el sink
recomendado por Hono mismo (`hono/logger` usa consola). De paso resuelve
la duplicación que había entre el `logger()` de Hono y el `customLogger`
propio: ahora solo hay un logger (el propio, a consola, con el formato ya
establecido + `requestId` para correlación) — se optó por el propio en
vez de `hono/logger` porque ya tenía el formato exacto que pedía el
checklist de auditoría (método, url, status, duración), `hono/logger` de
fábrica no.

## Middlewares oficiales de Hono adoptados

Pedido explícito: revisar el catálogo completo de Hono
(https://hono.dev/docs/helpers/testing y la lista de middlewares) y
adoptar los que sirvan. Todos vienen incluidos en el paquete `hono` ya
instalado — cero dependencias nuevas. Ver
[`src/index.ts`](../src/index.ts) para el orden real (importa el modelo
onion: el primero registrado envuelve a los siguientes).

| Middleware | Adoptado | Por qué |
|---|---|---|
| `hono/bearer-auth` | Ya estaba | — |
| `hono/cors` | Ya estaba | — |
| `hono/pretty-json` | Ya estaba | — |
| `hono/request-id` | ✅ nuevo | Correlaciona cada línea de log (acceso + error) con un id único — cierra el hallazgo 10/checklist de auditoría. |
| `hono/secure-headers` | ✅ nuevo | `X-Frame-Options`, `HSTS`, `X-Content-Type-Options`, `Referrer-Policy`, etc. — costo cero, cierre directo de huecos de seguridad. Verificado en vivo con `curl -i`. |
| `hono/body-limit` | ✅ nuevo | 50kb global — todos los payloads reales son formularios chicos, un body más grande ya es abuso. |
| `hono/compress` | ✅ nuevo | gzip/brotli de las respuestas JSON. Verificado que sigue funcionando bajo Bun. |
| `hono/etag` | ✅ nuevo | Global — condicional 304 para clientes que ya tienen la misma respuesta (proyectos/experiencias/comentarios cambian poco). |
| `hono/timeout` | ✅ nuevo | 10s cap global — protege contra un query a Turso o un fetch a Telegram colgado indefinidamente. |
| `hono/trailing-slash` | ✅ nuevo | `trimTrailingSlash()` — normaliza rutas con/sin `/` final. |
| `hono/csrf` | ✅ nuevo, con matiz documentado | Ver "Nota honesta sobre CSRF" abajo — se agrega como defensa en profundidad barata, no como el mecanismo principal. |
| `hono/basic-auth` | ❌ no aplica | Ya hay bearer auth; no hace falta un segundo esquema. |
| `hono/cache` | ❌ no todavía | Tiene sentido una vez que exista invalidación por escritura real (TODO.md §5.3 de Portafolio, ligado a las tablas nuevas) — cachear ahora sin eso deja datos viejos tras cada cambio del admin. |
| `hono/combine` | ❌ no hace falta | Con las 10 rutas admin de la Fase 4b (`comments`, `contact-messages`, `projects`, `experiences`) cada una sigue aplicando `adminAuth` inline sin repetición real de sets de middleware - no hay un caso concreto todavía que lo justifique. |
| `hono/context-storage` | ❌ no | `c` ya se pasa explícito a todo lo que lo necesita; no hay un caso real hoy que justifique `AsyncLocalStorage`. |
| `hono/ip-restriction` | ❌ no aplica | El admin no trabaja desde IPs fijas. |
| `hono/jsx-renderer` | ❌ no aplica | Esto es una API pura, sin JSX/HTML. |
| `hono/jwt` | ✅ Fase 4a | Pieza central del hallazgo 3 (JWT de sesión admin) — ver `03-hono-admin-auth.md`. |
| `hono/jwk` | ❌ no aplica | Es para verificar JWTs de un proveedor externo (OAuth/OIDC) vía JWKS público - este JWT es interno, firmado con una clave simétrica propia (`HS256`), no hay proveedor externo que publique claves. |
| `hono/language` | ✅ agregado (pedido explícito) | Configurado con `lookupQueryString: "currentLocale"` — mismo nombre que ya usaba el contrato con Astro, no lo duplica. Ver [`05-hono-language-and-best-practices.md`](05-hono-language-and-best-practices.md) para el detalle y el cambio de comportamiento (locale inválido-pero-presente ya no es 400, cae al fallback). |
| `hono/method-override` | ❌ no aplica | El admin es un cliente moderno (fetch), no un `<form>` viejo que necesite espoofear PUT/DELETE. |
| `hono/timing` | ❌ no | Expone timing interno en un header público — más riesgo de fuga de info que valor real hoy. |

### Nota honesta sobre CSRF

Se agregó `csrf({ origin: [...] })`, pero probado en vivo (`curl` con
`Origin` cruzado + `Content-Type: application/json`) **no bloqueó la
petición** — no es un bug de configuración. El middleware de Hono solo
protege requests con `Content-Type` de formulario clásico
(`application/x-www-form-urlencoded`, `multipart/form-data`,
`text/plain`), que son los únicos capaces de saltarse el preflight CORS.
Esta API solo acepta JSON, que **ya** dispara preflight y **ya** lo
bloquea `corsMiddleware` (`hono/cors`) si el origen no está en la lista.
Se deja igual como defensa en profundidad (costo cero, protege si algún
día se agrega un endpoint `x-www-form-urlencoded`), pero la protección
real contra escritura cross-origin en este backend hoy es CORS + bearer
token, no CSRF.

## `bun audit`

**Antes**: 46 vulnerabilidades (7 high, 36 moderate, 3 low) — casi todas
colgando de `hono` y `drizzle-orm` desactualizados.

**Después de actualizar dependencias** (`hono` 4.9.1→4.13.7,
`@hono/zod-validator` 0.7.2→0.9.1, `drizzle-orm` 0.44.4→0.45.2,
`drizzle-kit` 0.31.4→0.31.10, `@libsql/client` 0.15.11→0.18.0, `zod`
4.0.17→4.6.5, alineado con la versión que ya usa el repo Portafolio):
**3 vulnerabilidades** (1 high, 2 moderate), ambas nested, evaluadas una
por una:

- **`ws` (high, memory exhaustion DoS) — forzado a `>=8.20.1` vía
  `pnpm`-style `overrides` en `package.json`** (Bun también respeta este
  campo). Anidado en `@libsql/client → @libsql/hrana-client →
  @libsql/isomorphic-ws → ws`, incluso en la última versión de
  `@libsql/client`. No se dejó como "riesgo aceptado" porque sí es
  runtime real: el cliente de Turso usa el protocolo Hrana sobre
  WebSocket para `libsql://` (confirmado por `TURSO_DATABASE_URL`), no es
  solo dev-time.
- **`esbuild` (moderate, dev server request read) — riesgo aceptado, no
  forzado**. Anidado en `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader →
  @esbuild-kit/core-utils → esbuild@0.18.20` — un paquete legado
  (`@esbuild-kit/*`, deprecado upstream) que `drizzle-kit` sigue trayendo
  incluso en su última versión. Solo se ejecuta cuando alguien corre
  `bun run db:generate`/`db:migrate`/`db:studio` a mano en su máquina —
  nunca en el runtime de producción (la función serverless no incluye
  `drizzle-kit`). Mismo patrón que Portafolio aceptó para
  `@vercel/nft > tar` (herramienta de build, no runtime).

## Testing

Se usó `bun test` (el runner nativo de Bun, cero dependencias nuevas —
este repo ya corre con Bun) en vez de la variante tipada RPC
(`testClient` de `hono/testing`, la que pedía explícitamente el enlace de
testing de Hono). Motivo verificado, no supuesto: `testClient` necesita
que las rutas estén encadenadas (`new Hono().get(...).post(...)` como una
sola expresión) para que TypeScript infiera el árbol de rutas y genere el
cliente tipado (`client.comments.$get()`); los routers de este repo están
escritos como sentencias separadas (`router.get(...)`, luego
`router.post(...)`), un patrón más legible para el tamaño actual del
proyecto que no vale la pena romper solo por ergonomía de test. En su
lugar se usó `app.request(path, init)` — el patrón que la propia guía de
testing de Hono (no solo el helper) muestra como la forma primaria y más
simple: llama a la app real, sin servidor, sin mocks de red, con
`Request`/`Response` estándar. Se llega al mismo resultado (probar la app
real de punta a punta) sin necesitar el refactor de las rutas.

**Cero tests tocan Turso o Telegram real**:
- `tests/setup.ts` (registrado como `preload` en `bunfig.toml`) reemplaza
  `src/lib/db.ts` completo por un doble genérico
  (`tests/mocks/fakeDb.ts`) antes de que cualquier test importe
  `src/index.ts` — ningún `GET`/`POST` en los tests llega a la base de
  datos real.
- El test de `POST /tlgrm` mockea `globalThis.fetch` — confirma que se
  llama exactamente una vez, sin mandar ningún mensaje real al bot.

15 tests, 25 aserciones, corriendo en verde (`bun test`).

## Verificación end-to-end de esta fase

Además del `bun test` automatizado:

- Servidor real (`bun run --watch src/index.ts`) + `curl` con el
  `API_TOKEN` real: auth (401/401/200), rate limit real disparando en el
  intento 6, validación de `currentLocale`, headers de
  `hono/secure-headers` presentes, `X-Request-Id` presente, shape de
  error de Zod normalizado.
- Con Astro corriendo en paralelo (`localhost:4321`) contra este backend
  ya endurecido y el nuevo basePath `/api`: la sección de Proyectos y de
  Opiniones cargan datos reales de Turso sin error de consola — confirma
  que el cambio de basePath + `VITE_API_URL` actualizado no rompió nada
  en el flujo real.
- **No** se probó `POST /comments` con datos reales contra la Turso de
  producción (para no ensuciarla con comentarios de prueba) — cubierto
  por el test automatizado con la base mockeada en su lugar.

## Fases siguientes

Documentado en detalle en el plan de sesión
(`C:\Users\MikeT\.claude\plans\stateless-humming-pinwheel.md`) y en
`docs/TODO.md` §5 del repo Portafolio:

- **Fase 2** ✅ hecha — backup completo de Turso antes de tocar cualquier
  tabla. Ver [`01-backup-turso.md`](01-backup-turso.md).
- **Fase 3** ✅ hecha, ambos repos — columna `status` en `comments`
  (moderación), tabla `contact_messages` nueva, eliminación completa del
  módulo de Telegram, rate limit conectado al proxy público de Portafolio
  (`v3.7.0`). Ver [`02-comentarios-y-contacto.md`](02-comentarios-y-contacto.md).
- **Fase 4a** ✅ hecha — tabla `users` (Argon2id vía `Bun.password`),
  `POST /auth/login`, JWT de sesión admin (hallazgo 3) distinto del
  `API_TOKEN` fijo, aplicado a `GET/PUT` de `comments`/`contact_messages`
  admin. Ver [`03-hono-admin-auth.md`](03-hono-admin-auth.md) — incluye
  la reparación real (esta vez sí) de `__drizzle_migrations`.
- **Fase 4b** ✅ hecha — CRUD completo (`POST`/`PUT`/`DELETE`) de
  `projects` y `experiences`, protegido por el JWT de 4a, con
  transacciones reales y cascada verificada. Ver
  [`04-hono-projects-experiences-crud.md`](04-hono-projects-experiences-crud.md)
  — incluye un hallazgo real de seguridad (CSRF bloqueando `DELETE` sin
  `Content-Type`) y las convenciones nuevas de código (tests por
  recurso, límite de 250 líneas por archivo, tipos centralizados en
  `interfaces.ts`, checklist OWASP) vigentes desde aquí en adelante.
- **Fase 4c** ✅ hecha (repo Portafolio) — `login.ts` dejó de comparar
  `ADMIN_PASSWORD` (eliminado) y llama a `POST /auth/login`;
  `adminSession.ts` embebe el JWT en la cookie de sesión existente
  (`getHonoJwt`/`buildSessionToken(secret, honoJwt)`); `admin/resource.ts`
  manda `X-Admin-JWT: Bearer <token>` en escrituras + `Content-Type`
  explícito incluso en `DELETE`. Verificado en vivo (login real, sesión,
  round-trip completo).
- **Fase 5a** ✅ hecha — tablas nuevas `about` (singleton, solo
  `GET`/`PUT`), `education` y `skills` (listas, CRUD completo), mismo
  patrón `_default`/`_translations` que `experiences.ts`, protegidas por
  el JWT de Fase 4a. Contenido real migrado desde el código estático de
  Portafolio vía `scripts/seed-content.ts`. Ver
  [`06-about-education-skills.md`](06-about-education-skills.md).
