# Arquitectura

`Backend_Portafolio` es la API de contenido del portafolio: un **Worker de
Cloudflare** hecho con **Hono**, con **D1** (SQLite) como base de datos y **R2**
para las imágenes. Es la **única pieza que escribe datos**. La consumen dos
clientes, ambos por HTTP:

| Cliente                      | Para qué                                     | Cómo llega                                                                                       |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Portafolio` (sitio público) | Leer contenido; dejar comentarios y mensajes | Proxy `/api/*` del sitio, con bearer token                                                       |
| `Portafolio_admin` (CMS)     | Leer y escribir todo el contenido            | Service Binding `BACKEND` (URL pública en local), con bearer token y sesión de Cloudflare Access |

## Piezas

| Binding           | Servicio                           | Para qué                                                               |
| ----------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `DB`              | Cloudflare D1 (`portafolio-db`)    | Contenido, comentarios, mensajes, textos del sitio e historial         |
| `MEDIA`           | Cloudflare R2 (bucket `portfolio`) | Imágenes. En la base solo se guarda la **clave** (`projects/abc.webp`) |
| `RL_PUBLIC_WRITE` | Rate Limiting de Workers           | 5 peticiones por 60 s en los POST públicos, por IP del visitante       |

Las **traducciones** (es, en, fr) viven en la misma fila, en la columna JSON
`translations`: D1 no tiene transacciones interactivas, y así cada escritura es
una sola sentencia. Lo que no está traducido cae al valor `*_default`.

## Estructura del código

```
src/
├── index.ts          # app de Hono: middlewares globales y rutas
├── env.ts            # tipos de bindings, secretos y variables
├── routes/           # una por recurso: define rutas, validación y política de acceso
├── controllers/      # lógica de cada recurso (consultas con Drizzle)
├── schemas/          # tablas de Drizzle + esquemas de Zod (fuente de las migraciones)
├── middleware/       # access (JWT), cors/csrf, db, errores, logger, rate limit
├── lib/              # auditoría, concurrencia optimista, reordenar, WebP, traducciones…
└── interfaces/       # tipos compartidos
drizzle/              # migraciones SQL versionadas (0000 a 0003 y su meta)
tests/                # unit, security, property, integration, support
```

## Orden de los middlewares

Se registran en `src/index.ts`, en este orden:

1. `requestId` y `customLogger`: cada petición lleva un id para rastrear el log.
2. `onError` y `notFound`: toda excepción y toda ruta inexistente responden el
   mismo JSON `{ success, message }`; el detalle interno solo va al log.
3. `trimTrailingSlash`, `secureHeaders` (con una **CSP mínima**) y `cors`.
4. `languageDetector`: `?currentLocale=es|en|fr` (`es-MX` cae a `es`).
5. `csrf`, `bodyLimit` (50 KB), `etag`, `timeout` (10 s) y `prettyJSON`. La
   subida de imágenes (`/api/media`) tiene su propio tope y más tiempo.
6. `GET /api`: salud y versión, **sin autenticación**.
7. **`bearerAuth`**: todo lo que se registra después exige el token.
8. `dbMiddleware`, y las rutas.

> `hono/csrf` trata una escritura **sin** `Content-Type` como `text/plain` y la
> bloquea. Todo cliente debe mandar `Content-Type: application/json` en cada
> escritura, incluso un `DELETE` sin cuerpo.

## Autenticación y autorización

Tres niveles, de menos a más estricto:

| Nivel  | Qué exige                                                            | Rutas                                                                             |
| ------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Salud  | Nada                                                                 | `GET /api`                                                                        |
| Bearer | `Authorization: Bearer <token>`                                      | Lecturas públicas y los POST públicos                                             |
| Access | Bearer **y** sesión de Cloudflare Access (`Cf-Access-Jwt-Assertion`) | Todo lo del CMS: `/admin`, `POST`, `PUT`, `DELETE`, reordenar, medios y auditoría |

- **Tokens.** `API_TOKEN` es el del sitio público. `API_TOKEN_ADMIN` es opcional:
  si existe, es el **único** que acepta el nivel Access, y `API_TOKEN` solo vale
  para las lecturas públicas. Se pone igual en `API_SECRET_TOKEN` del admin.
- **JWT de Access.** Se verifica la firma contra las llaves del equipo
  (`ACCESS_TEAM_DOMAIN`), la audiencia (`ACCESS_AUD`), que no esté expirado
  (`exp` es obligatorio) y que no sea de otro emisor. **Falla cerrado**: sin
  configuración responde 503 y no deja pasar a nadie.
- **Local.** `wrangler dev` no pasa por Access: se usa `ACCESS_JWKS` (llaves
  públicas) en `.dev.vars` y un JWT firmado con la llave privada. El admin lo
  genera con `pnpm dev:access`. `ACCESS_JWKS` **solo se lee cuando la petición
  llega a `localhost`**: en el Worker desplegado se ignora aunque alguien la cargue.
- **CORS** restringido a `ALLOWED_ORIGINS`, nunca `*`.

Las rutas nuevas deben declararse en `tests/security/routeInventory.test.ts`: una
ruta sin política **rompe el test**.

## Rutas

Todas bajo `/api`.

**Lectura pública** (`?currentLocale=es|en|fr`): `GET /projects`, `/experiences`,
`/education`, `/skills`, `/about`, `/comments`, `/site-copy` (hero, manifiesto,
descripción y foto del hero) y `/contact-info` (GitHub, LinkedIn, teléfono y
correo; iguales en todos los idiomas).

**Escritura pública, con límite:** `POST /comments` y `POST /contact-messages`.
El límite es por visitante: el sitio manda la IP real en `X-Visitor-IP` (solo se
lee porque la petición ya pasó el bearer; sin ella manda la IP de Cloudflare).
Comentarios exigen `country_flag` de 2 letras y `country` de hasta 100 caracteres.

**CMS** (bearer + Access):

- Proyectos, experiencias, educación y habilidades: `GET /<recurso>/admin`, `POST`,
  `PUT /:id`, `DELETE /:id` y `PUT /<recurso>/order` (reordenar en lote, atómico).
- `PUT /about`, `GET /contact-info/admin` y `PUT /contact-info`, `GET
  /site-copy/admin` y `PUT /site-copy`: una sola fila cada uno.
- Comentarios: `GET /comments/admin`, `PUT /comments/:id` (moderar),
  `DELETE /comments/:id` y `GET /comments/pending-count`.
- Bandeja: `GET /contact-messages` (`?status=unread|read|replied`), `GET
  /contact-messages/unread-count`, `PUT /contact-messages/:id` y `DELETE`.
- Medios: `POST /media` (cuerpo binario `image/webp`), `GET /media` (con dónde se
  usa cada imagen) y `DELETE /media/:key`.
- Currículum: `POST /cv` (cuerpo binario `application/pdf`, hasta 5 MB), `GET /cv` y
  `DELETE /cv`. Es **un solo PDF**: subir otro reemplaza al anterior. Se guarda en R2 como
  `cv/CV-Erick-Gonzalez-<id>.pdf` con `Content-Disposition: inline` (el navegador lo abre) y
  su clave vive en `site_copy.cv_pdf_key`; el sitio la recibe en `GET /site-copy` como
  `cv_pdf`. No aparece en Medios ni se puede borrar desde ahí.
- `GET /audit?limit=`: historial de cambios del CMS.

## Comportamientos que conviene conocer

- **Edición optimista.** Los `PUT` aceptan el `updated_at` que leyó el formulario
  y responden **409** si la fila cambió desde entonces (edición en dos pestañas).
  Sin él, reemplazan como siempre.
- **Historial.** Cada escritura del CMS queda en `audit_log` (quién, qué y cuándo);
  se conservan las últimas 1 000 filas.
- **Imágenes.** Solo WebP real: el servidor verifica el encabezado, que las
  dimensiones no pasen de 4096 px y que pesen como máximo 2 MiB, y genera la
  clave. Borrar una imagen en uso responde **409** con dónde se usa.
- **Validación.** Zod en cada entrada. Las URLs aceptan solo `http(s)`; las claves
  de R2 no admiten `..`, esquemas ni `//host`; los ids deben ser enteros canónicos.
- **Errores.** Siempre JSON con el mismo formato. Un fallo interno no devuelve
  mensaje, traza ni rutas; solo queda en el log con el id de petición.

## Variables y secretos

| Nombre                             | Tipo              | Para qué                                         |
| ---------------------------------- | ----------------- | ------------------------------------------------ |
| `API_TOKEN`                        | Secreto           | Bearer del sitio público                         |
| `API_TOKEN_ADMIN`                  | Secreto, opcional | Bearer exclusivo del CMS                         |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Variable          | Verificación del JWT de Access (no son secretos) |
| `ACCESS_JWKS`                      | Solo local        | Llaves públicas de prueba en `.dev.vars`         |
| `ALLOWED_ORIGINS`                  | Variable          | Orígenes permitidos por CORS                     |
| `PUBLIC_MEDIA_URL`                 | Variable          | Origen público del bucket de R2                  |

Los **secretos** no van en `wrangler.jsonc`: se cargan con `wrangler secret put`.
`repoHygiene.test.ts` falla si aparece uno en el código o en `vars`.

## Migraciones

La fuente de verdad del esquema son los archivos de `src/schemas/`. Después de
editarlos:

```bash
bun run db:generate        # crea la migración SQL en drizzle/
bun run db:migrate:local   # D1 local
bun run db:migrate:remote  # D1 de producción
```

- No se edita una migración ya aplicada: cada cambio es una migración nueva.
- El **deploy no aplica migraciones**. Si un cambio toca `drizzle/`, se aplican
  en remoto **antes** de mergear a `main`, y deben ser compatibles con el código
  anterior (durante unos segundos conviven).
- `bun run db:drift` falla si el esquema y las migraciones se separaron.

## Historia

El backend nació sobre Turso (libSQL) y la documentación de esa etapa está en
[`legacy-v2/`](./legacy-v2/README.md). Las herramientas con las que se migró a D1
no se versionan.
