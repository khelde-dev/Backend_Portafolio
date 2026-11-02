# Backend_Portafolio

API de contenido del portafolio: **Hono en un Cloudflare Worker**, base de datos **Cloudflare D1** (SQLite) con Drizzle, imágenes en **Cloudflare R2**. Las rutas de escritura del CMS las protege **Cloudflare Access**.

## Cómo encaja

| Pieza | Para qué |
|---|---|
| `DB` (D1) | contenido: proyectos, experiencia, educación, habilidades, acerca de, comentarios y mensajes de contacto |
| `MEDIA` (R2, bucket `portfolio`) | imágenes; en la base solo se guardan **claves** (`projects/abc.webp`) |
| `API_TOKEN` (secreto) | bearer token que usa el proxy del portafolio |
| Cloudflare Access | login del admin (SSO / código por correo); el Worker solo verifica el JWT `Cf-Access-Jwt-Assertion` |
| `RL_PUBLIC_WRITE` | límite de peticiones para los POST públicos (comentarios, contacto) |

Las traducciones (es/en/fr) viven **en la misma fila** (columna JSON `translations`): D1 no tiene transacciones interactivas y así cada escritura es una sola sentencia. Lo que no está traducido cae al valor `*_default`.

## Primera vez (una sola vez, con tu cuenta de Cloudflare)

```bash
bun install
bunx wrangler login
bunx wrangler d1 create portafolio-db          # pega el database_id en wrangler.jsonc
bunx wrangler secret put API_TOKEN             # el mismo valor que API_SECRET_TOKEN del portafolio
bun run db:migrate:remote                      # crea las tablas
```

Cloudflare Access: en Zero Trust crea una *Self-hosted application* para el dominio del admin y copia su **AUD tag** y tu **team domain** (`https://<equipo>.cloudflareaccess.com`) a `ACCESS_AUD` y `ACCESS_TEAM_DOMAIN` en `wrangler.jsonc`. Mientras estén vacíos, las rutas del CMS responden 503 (no dejan pasar a nadie).

## Datos desde Turso

```bash
bun run db:import-turso backups/turso/<fecha>        # genera backups/d1-import.sql (fuera de git)
bunx wrangler d1 execute DB --remote --file=backups/d1-import.sql
```

Convierte el respaldo (un JSON por tabla) al esquema nuevo y mete las traducciones en la columna JSON. Las tablas que falten en el respaldo quedan vacías.

## Desarrollo

```bash
bun run db:migrate:local   # D1 local (Miniflare)
bun run dev                # wrangler dev
bun test                   # pruebas (base falsa, sin red)
bun run smoke:d1           # prueba de humo contra el D1 local real
bun run typecheck
```

Para llamar a las rutas del CMS en local, `wrangler dev` no pasa por Access: usa `ACCESS_JWKS` (llaves públicas) en `.dev.vars` y un JWT firmado con la llave privada correspondiente.

## Migraciones

Edita `src/schemas/*.ts`, corre `bun run db:generate` y aplica con `db:migrate:local` / `db:migrate:remote`. No edites una migración ya aplicada: cada cambio es una migración nueva.

## Rutas

Todas bajo `/api`, todas con `Authorization: Bearer <API_TOKEN>`.

- Públicas (lectura, `?currentLocale=es|en|fr`): `GET /projects`, `/experiences`, `/education`, `/skills`, `/about`, `/comments`.
- Públicas (escritura, con límite): `POST /comments`, `POST /contact-messages`.
- CMS (además, sesión de Cloudflare Access): `GET /<recurso>/admin`, `POST`, `PUT /:id`, `DELETE /:id` sobre proyectos, experiencias, educación y habilidades; `PUT /about`; moderación de comentarios (`GET /comments/admin`, `PUT /comments/:id`) y bandeja de contacto: `GET /contact-messages` (`?status=unread|read|replied`), `GET /contact-messages/unread-count`, `PUT /contact-messages/:id` (cambia el estado; `replied` guarda `replied_at`) y `DELETE /contact-messages/:id`.
