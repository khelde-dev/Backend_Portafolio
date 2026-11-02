# Comentarios con moderación + fin de Telegram — Fase 3

Decisión tomada explícitamente (no era una opción abierta en esta
ronda): el módulo de Telegram se elimina por completo — ni siquiera queda
como notificación paralela (`docs/03-diseno-api.md`/
`docs/02-panel-admin-requisitos.md` del repo Portafolio lo dejaban
condicional; queda resuelto aquí). Todo lo que antes iba a un chat de
Telegram vive ahora en Turso, visible desde el admin/dashboard que se va
a construir.

## Qué cambia

### 1. Comentarios ya no se publican en vivo

`POST /comments` ahora **siempre** inserta con `status: "pending"` — sin
excepción, sin importar qué mande el cliente (el schema público ni
siquiera acepta un campo `status` en el body, ver
`userInputSchema.omit({direction: true, status: true})` en
`src/schemas/comments.ts`). `GET /comments` (la lectura pública que usa
el sitio) filtra `WHERE status = 'published'` — un comentario nuevo no
aparece hasta que alguien lo apruebe desde el admin.

Esto es el cierre real del hallazgo 1 de `docs/00-auditoria.md` (el
hackeo de 800 comentarios): el rate limit de la Fase 1 frena el volumen,
esto frena que cualquier volumen que logre pasar el rate limit termine
visible sin que alguien lo vea primero.

`GetAllCommentsAdmin()` (todos los estados) ya existe en
`src/controllers/comments.controllers.ts`, pero **sin ruta que la
exponga todavía** — no hay forma real de distinguir "es el admin
autenticado" de "trae el `API_TOKEN` fijo" (es el mismo token para
lecturas públicas y todo lo demás). Exponerla ahora sería mostrar
comentarios pendientes (potencialmente spam) a cualquiera con el token
público. Se conecta a una ruta real en la Fase 4 (JWT de sesión admin).

### 2. `contact_messages` reemplaza a Telegram

Tabla nueva (`src/schemas/contactMessages.ts`):
`message_id, name, email, phone, more_information, status, created_at`
— `status`: `'unread' | 'read' | 'replied'`, nace siempre `'unread'`.

`POST /contact-messages` (antes `POST /tlgrm`) — mismo rate limit que
`/comments` (5/60s). Dos mejoras reales sobre el endpoint viejo, no solo
el reemplazo del canal:

- **Valida con Zod de verdad** (`@hono/zod-validator`) — el viejo
  `/tlgrm` no validaba nada, casteaba con `String(data.x ?? "")`.
- **`phone` es `string`, no `number`** — el código viejo hacía
  `Number(data.phone ?? 0)`, que silenciosamente convertía cualquier
  teléfono con formato (`+52 555 555 5555`, con espacios/guiones/
  paréntesis — exactamente lo que valida `contactSchema.ts` en el repo
  Portafolio) en `NaN` o `0`. Bug real, encontrado al migrar, no solo
  estilo.

`GetAllContactMessages()` existe (`src/controllers/contactMessages.controllers.ts`),
misma razón que `GetAllCommentsAdmin` — sin ruta hasta la Fase 4.

### 3. Telegram, eliminado

Borrados: `src/controllers/telegram.controllers.ts`,
`src/routes/telegram.routes.ts`, su registro en `src/index.ts`,
`BOT_TOKEN`/`CHAT_ID` de `env.d.ts` y del `.env` local. La interfaz
`Telegrm` se quitó de `src/interfaces/interfaces.ts`.

**Pendiente, fuera de git**: `BOT_TOKEN`/`CHAT_ID` siguen en las
variables de entorno de Vercel del proyecto `Backend_Portafolio`
(producción) — ya no los lee nada, se pueden borrar del dashboard cuando
se quiera, no son urgentes (no representan un hueco de seguridad activo,
solo son basura de config).

### Coordinación con el repo Portafolio (fuera de este repo)

- `src/pages/api/tlgrm.ts` y `Form.tsx` (contacto) deben apuntar al nuevo
  `POST /api/contact-messages` en vez de `/api/tlgrm`.
- `src/pages/api/[resource].ts`: conectar `src/lib/rateLimit.ts` (ya
  protege `/api/admin/login`) al `POST` público de `comments` — el rate
  limit de Hono (Fase 1) ya cierra el hueco si alguien pega directo a
  Hono, pero el proxy de Astro (la puerta que el público real usa)
  todavía no tiene el suyo propio.

## Migración de esquema — hallazgo real durante la ejecución

`bun run db:migrate` **está roto** para este repo, descubierto al
intentar aplicar esta migración: `__drizzle_migrations` (la tabla que
Drizzle usa para saber qué migraciones ya corrieron) solo tiene
registrados 4 hashes, pero hay 10 archivos de migración históricos
(`0000`-`0009`). Las migraciones `0004`-`0009` **ya estaban aplicadas de
verdad** en la base (confirmado: sus columnas/tablas ya existían) pero
nunca se registraron — probablemente se aplicaron alguna vez con
`drizzle-kit push` (que sincroniza sin dejar historial) o a mano, no con
`drizzle-kit migrate`. No es algo que esta ronda causó, solo lo
destapó: nadie había corrido `db:migrate` desde entonces.

**Corrección (ver `03-hono-admin-auth.md`)**: en esta ronda **no** se
logró escribir en `__drizzle_migrations` — el intento fue bloqueado por
el clasificador de permisos de la sesión incluso con permiso explícito
del usuario en el chat, y el reintento se abandonó. Lo que realmente pasó
aquí: `0010` (tabla `contact_messages` + columna `status` en `comments`)
se aplicó **directo contra Turso** con un script de un solo uso
(`node`+`@libsql/client`, sin pasar por `drizzle-kit migrate`), y la
ledger se quedó **desincronizada igual que antes** — `bun run db:migrate`
siguió roto después de esta fase, no antes. El registro se corrigió de
verdad hasta la Fase 4
(`scripts/backfill-migrations-ledger.mjs`, ver `03-hono-admin-auth.md`).

Las dos líneas `ALTER TABLE comments ALTER COLUMN ... TO ... NOT NULL`
que `drizzle-kit generate` había agregado a `0010` (para forzar
`country`/`country_flag` a `NOT NULL`, detectado porque el esquema de
Turso real tiene `country` como nullable mientras `comments.ts` lo
declara `.notNull()`) se quitaron de la migración aplicada — esa sintaxis
específica de libSQL no se comportó como se esperaba contra Turso
(devolvía `duplicate column name` en vez de alterar el tipo). Es un
hallazgo aparte, de bajo riesgo real hoy (0 filas con `country` en
`NULL`, confirmado), que queda pendiente como su propia tarea de
seguimiento — no bloqueaba nada de esta fase.

## Verificación end-to-end

Contra el servidor real (`bun run --watch src/index.ts`) y la Turso real,
con limpieza inmediata de las filas de prueba después:

- `POST /comments` real → `status: "pending"` confirmado en la
  respuesta.
- `GET /comments` inmediatamente después → mismo conteo que antes del
  POST, el comentario nuevo **no aparece** — confirma que el filtro
  `WHERE status = 'published'` funciona contra la base real, no solo en
  el mock.
- `POST /contact-messages` real → `status: "unread"`, `phone` guardado
  como string con formato intacto.
- `POST /tlgrm` → `404`, confirmado que la ruta vieja ya no existe.

`bun test`: 16 tests, cero tocan Turso/red real (mismo mecanismo de
mocks que la Fase 1, extendido).
