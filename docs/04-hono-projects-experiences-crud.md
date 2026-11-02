# CRUD de `projects`/`experiences` + convenciones de código — Fase 4b

Cierra el hallazgo de contexto de la Fase 4a: Hono no tenía **ninguna**
ruta de escritura para `projects`/`experiences` — el panel admin (WIP) le
pegaba a `PUT`/`POST`/`DELETE` que nunca existieron del lado de Hono.
Además de construir el CRUD, esta ronda incorpora tres pedidos explícitos
de convención de código que aplican desde aquí en adelante, no solo a
este PR.

## Convenciones nuevas, vigentes desde ahora

### 1. Un archivo de test por recurso, no un archivo monolítico

`tests/app.test.ts` había crecido hasta 560 líneas con **todas** las
rutas de la API en un solo archivo. Se partió en:

- `tests/helpers.ts` — utilidades compartidas (`authed`, `adminAuthed`,
  `uniqueIp`), antes duplicadas al principio de cada bloque.
- `tests/health.test.ts`, `tests/auth.test.ts`, `tests/comments.test.ts`,
  `tests/contactMessages.test.ts`, `tests/experiences.test.ts`,
  `tests/projects.test.ts` — uno por recurso, cada `describe`/`it` prueba
  un comportamiento concreto (un status code, una validación, un efecto
  secundario puntual), no "todo el archivo de rutas" de una vez. Crecen
  en paralelo entre sí en vez de competir por el mismo archivo.

### 2. Ningún archivo de código (`src/`) o test pasa de 250 líneas

Se logró sin sacrificar cobertura extrayendo lo que estaba duplicado en
cada router nuevo:

- **`src/lib/zodErrorHook.ts`**: el hook de error de `zValidator` vivía
  copiado (10 líneas) en cada archivo de rutas. Un solo lugar ahora.
- **`src/lib/auditLog.ts`**: ver más abajo (OWASP A09).

El archivo más largo de este PR es `tests/comments.test.ts` con 215
líneas — el resto de `src/` queda entre 40 y 152 líneas. Si un archivo se
acerca al límite, la señal es extraer un helper compartido (como los dos
de arriba), no partir el archivo arbitrariamente a la mitad.

### 3. Los tipos compartidos se re-exportan todos desde `src/interfaces/interfaces.ts`

Antes, cada archivo importaba tipos directo del schema donde vivían
definidos (`InsertComment` de `schemas/comments.ts`,
`ProjectAdminInput` de `schemas/projects.ts`, etc.) — funcionaba, pero
significaba que "qué tipos existen en esta API" solo se podía averiguar
leyendo cada archivo de schema por separado. Ahora `interfaces.ts`
re-exporta **todos** los tipos (`InsertComment`, `SelectComment`,
`UpdateCommentStatusInput`, `ContactMessageUserInput`,
`ProjectAdminInput`, `ExperienceAdminInput`, `InsertUser`, `SelectUser`,
`LoginInput`, etc.) — los schemas siguen siendo donde se **definen**
(ahí es donde Drizzle/Zod los necesitan, junto a la tabla/schema real),
pero cualquier otro archivo que solo necesite el **tipo** lo importa de
`interfaces.ts`, no del schema. Sin ciclo real en runtime: los
`export type {...} from "..."` se borran del todo en compilación
(`verbatimModuleSyntax: true`), así que no hay una dependencia circular
de verdad entre `interfaces.ts` y los schemas que a su vez importan
`COMMENT_STATUSES`/`LOCALES`/etc. de `interfaces.ts` como valores.

### 4. Cortes tempranos con `HTTPException` de Hono, no `c.json(...)` a mano

Antes, cada `if (!result) return c.json({success:false, message:...}, 404)`
se repetía a mano en cada route handler. Ahora esos cortes tiran
`throw new HTTPException(status, {message})` — `errorHandler.middleware.ts`
(Fase 1) ya sabía formatear cualquier `HTTPException` al shape
`ApiResponse` correcto, así que no hacía falta reinventar el formato en
cada archivo de rutas. `src/lib/parseId.ts` (nuevo) hace lo mismo para el
parseo de `:id` — antes vivía duplicado, idéntico, en
`projects.routes.ts` y `experiences.routes.ts`. Confirmado con
`bun test` que el status code/shape de la respuesta no cambió para
ningún caso (400/401/404) — es un cambio de mecanismo, no de
comportamiento observable.

Las validaciones de Zod (`zValidator` + `zodErrorHook`) se quedan como
estaban — devuelven `errors: result.error.issues` (un array), que no
tiene un lugar natural en `HTTPException` (su `message` es un string
simple); forzarlas a ese molde habría sido peor, no mejor.

## Qué se construyó (CRUD)

- `POST/PUT/DELETE /projects`, `POST/PUT/DELETE /experiences` —
  protegidos por `adminAuth` (JWT, Fase 4a) desde el día uno.
- **Transacciones reales**: `db.transaction(async (tx) => {...})` —
  verificado que `drizzle-orm`/`@libsql/client` sí las soporta contra
  Turso remoto (probado en vivo antes de construir el resto: insert +
  return dentro de una transacción, contra la base real, funcionó).
  `CreateProject`/`UpdateProject`/`CreateExperience`/`UpdateExperience`
  insertan la fila principal y sus traducciones en la misma transacción
  — si la segunda parte falla, la primera se revierte.
- **Semántica de `PUT`**: reemplazo completo, incluidas las traducciones
  — se borran las traducciones viejas del recurso y se insertan las
  nuevas que mande el request. Más simple y menos propenso a bugs que
  reconciliar fila por fila cuál traducción cambió, cuál se agregó, cuál
  se borró.
- **`DELETE` usa cascada real de la base**, no borrado manual de las
  traducciones primero: `project_translations`/`experience_translations`
  tienen `onDelete: "cascade"` en el schema, y se verificó que
  `foreign_keys` está `ON` por default en esta conexión
  (`PRAGMA foreign_keys` → `1`) — sin esa verificación, la cascada
  declarada en Drizzle no se aplicaría de verdad (SQLite trae el
  enforcement de foreign keys apagado por conexión salvo que se pida
  explícito; se confirmó que Turso lo trae prendido, no se asumió).

### Limitación conocida, aceptada a propósito: `project_id` no autoincrement

`projects.project_id` es una PK manual desde el diseño original de la
tabla (no `autoIncrement`, a diferencia de `experience_id`). `CreateProject`
calcula el siguiente id con `MAX(project_id) + 1`. Bajo concurrencia real
esto tiene una ventana de carrera (dos creates al mismo tiempo podrían
calcular el mismo id) — aceptado explícitamente: es un panel de un solo
administrador, el riesgo real es prácticamente cero. Migrar la PK a
autoincrement implicaría recrear la tabla completa en SQLite (no se puede
alterar una PK existente in-place) — más riesgo del que vale la pena
resolver este problema en esta fase.

## Hallazgo real de seguridad, encontrado escribiendo los tests

`hono/csrf` (agregado en la Fase 1) trata **cualquier** request sin
header `Content-Type` como si fuera `text/plain` (uno de los tres tipos
de formulario clásico que protege) — y como un `DELETE` sin body
normalmente no lleva `Content-Type`, cada test de `DELETE` devolvía
`403 Forbidden`, no el `401`/`404`/`200` esperado. Confirmado que esto
**no era un bug de los tests**: es un comportamiento real del middleware
que habría bloqueado cualquier `DELETE` real desde el proxy de Astro en
producción (Fase 4c), ya que una llamada servidor-a-servidor tampoco
manda `Origin`/`Sec-Fetch-Site` (esos headers los pone el navegador, no
`axios`).

**Resuelto en dos lugares**:
1. `tests/helpers.ts`: `authed()` ahora manda
   `Content-Type: application/json` por default en toda request, no solo
   las que llevan body.
2. Comentario explícito en `src/index.ts` junto al middleware, marcado
   como requisito para cualquier cliente nuevo del API.

**Pendiente para la Fase 4c**: el proxy de Astro (`admin/resource.ts`)
tiene que mandar `Content-Type: application/json` explícito en su
llamada `DELETE` a Hono, aunque no lleve body — si no, el mismo 403
ocurre en producción.

## OWASP — qué ya cubre este backend

Pedido explícito de revisar esto en el proyecto. Repaso contra el OWASP
Top 10, con lo que ya está resuelto y dónde:

| # | Categoría | Estado |
|---|---|---|
| A01 | Broken Access Control | Rutas de escritura protegidas por JWT (`adminAuth`), lecturas públicas separadas del token fijo. Verificado en cada PUT/DELETE nuevo con test de "401 sin JWT". |
| A02 | Cryptographic Failures | Passwords con Argon2id (`Bun.password`), secretos (`API_TOKEN`, `ADMIN_JWT_SECRET`) en variables de entorno, nunca en código. |
| A03 | Injection | Drizzle ORM parametriza todas las queries - ningún string interpolado a mano en SQL en este repo (los scripts de mantenimiento que sí arman SQL crudo, ej. `backup-turso.ts`, usan `client.execute({sql, args})` parametrizado, nunca concatenación). |
| A04 | Insecure Design | Cola de moderación de comentarios, rate limiting en escrituras públicas, JWT distinto del token fijo para admin - decisiones de diseño explícitas, no parches. |
| A05 | Security Misconfiguration | `secure-headers`, CORS explícito, `basePath` ya no pretende ser un secreto (Fase 1). |
| A07 | Auth Failures | Login con rate limit, verificación timing-safe (`Bun.password.verify` + hash dummy si el email no existe), JWT de corta duración. |
| A08 | Software/Data Integrity | Dependencias actualizadas y auditadas (Fase 1, `bun audit` 46→3). |
| A09 | Security Logging | **Nuevo en esta fase**: `src/lib/auditLog.ts` - cada escritura admin (crear/editar/borrar proyecto o experiencia, cambiar status de comentario/mensaje) loguea qué admin (email del JWT), qué acción, qué recurso, cuándo. `auth.routes.ts` loguea también login exitoso y fallido (sin loguear la contraseña). Cerraba un pendiente explícito de `docs/03-diseno-api.md` (Portafolio) desde la Fase 1. |
| A10 | SSRF | No aplica - este backend no hace requests salientes a URLs que vengan de input de usuario (el módulo que sí lo hacía, Telegram, se eliminó en la Fase 3). |

No completo (fuera de alcance de este PR, ya documentado en fases
anteriores): 2FA sigue diferido (`two_factor_secret` reservado sin
lógica), la ventana de carrera de `project_id` (arriba).

## Verificación end-to-end (Turso real, con limpieza inmediata)

- `CreateExperience` real → fila + traducción `es` creadas, confirmado
  con una query directa a `experience_translations`.
- `GET /experiences?currentLocale=es` → `COALESCE` devuelve la
  traducción, no el default.
- `UpdateExperience` con una traducción `en` nueva → confirmado que la
  traducción `es` vieja se borró (reemplazo completo, no acumulación).
- `DeleteExperience` → confirmado `0` filas restantes en
  `experience_translations` para ese id (cascada real, no solo
  declarada).
- Mismo ciclo completo para `projects` (create con `project_id`
  calculado como `MAX+1`, delete con cascada confirmada).
- `bun test`: 49 tests en verde, cero tocan Turso/red real.

## Qué sigue

**Fase 4c** (repo Portafolio): `login.ts` deja de comparar
`ADMIN_PASSWORD` (se elimina) y llama a `POST /auth/login`;
`adminSession.ts` embebe el JWT de Hono en el payload firmado de la
cookie de sesión existente; `admin/resource.ts` manda
`X-Admin-JWT: Bearer <token>` **y** `Content-Type: application/json`
explícito (ver el hallazgo de CSRF arriba) en cada escritura.
