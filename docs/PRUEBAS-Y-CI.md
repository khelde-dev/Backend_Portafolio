# Pruebas y CI/CD

El Worker se despliega solo cuando llega código a `main` (integración Git de
Cloudflare), así que **lo que pasa por el CI es lo único que separa un cambio
de producción**. Este documento describe qué se prueba, cómo correrlo y cómo
dejar la puerta cerrada.

## Cómo está organizada la suite

| Carpeta              | Qué prueba                                                                                                | Base de datos                     | Comando                    |
| -------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------- |
| `tests/unit/`        | Rutas y controladores, un archivo por recurso                                                             | doble (`tests/support/fakeDb.ts`) | `bun run test:unit`        |
| `tests/security/`    | Ataques contra auth, JWT, CORS/CSRF, cabeceras, errores, entradas, límite de peticiones, higiene del repo | doble                             | `bun run test:security`    |
| `tests/property/`    | Propiedades con fast-check: invariantes y fuzzing de esquemas                                             | `bun:sqlite` en memoria           | `bun run test:property`    |
| `tests/integration/` | La app completa sobre una **D1 real** (Miniflare en memoria) con las migraciones reales                   | D1 real                           | `bun run test:integration` |

`bun run test` corre todo. `bun run test:coverage` mide cobertura de las tres
primeras (pisos en `bunfig.toml`: 95 % de líneas, 90 % de funciones) y
`bun run ci` repite localmente lo que corre GitHub Actions.

> Las pruebas unitarias necesitan el _preload_ que sustituye `createDb` por el
> doble; las de integración necesitan lo contrario. Por eso los scripts de
> `package.json` pasan `--preload` solo a las unitarias, y `bun test` a secas
> no sirve: usa `bun run test`.

### Seguridad: qué cubre cada archivo

- **`routeInventory`** — la lista de rutas con su política (`health`, `bearer`,
  `access`) es explícita. Una ruta nueva sin declarar **rompe el test**, y cada
  ruta se prueba sin token, con token falso, sin sesión de Access y con todo
  válido. Además verifica que la autenticación va _antes_ que la validación
  (no se filtra el esquema) y que una ruta inexistente responde igual que una
  protegida.
- **`accessJwt`** — JWT expirado, sin `exp`, `nbf`/`iat` futuros, `aud`/`iss`
  ajenos o ausentes, `alg: none`, confusión HS256 con la llave pública, firma
  de otro par de llaves, `kid` desconocido o ausente, payload alterado, basura
  y tokens enormes. Falla cerrado si Access no está configurado (503).
- **`corsCsrf`** — orígenes hostiles (subdominios falsos, `null`, otro puerto o
  esquema, mayúsculas), nunca `*`, métodos y cabeceras permitidos, y CSRF con
  los tres tipos de formulario.
- **`headersAndErrors`** — cabeceras de seguridad, JSON siempre, formato único
  de error, y que un fallo interno **no** devuelva mensaje, traza ni rutas
  (solo queda en el log con el id de petición).
- **`inputHardening`** — JSON roto, tipos equivocados, slugs, URLs
  `javascript:`/`data:`/`file:`, claves de R2 con `..`/esquemas, ids no
  canónicos (`1e3`, `0x10`), asignación masiva, `__proto__`, inyección en
  parámetros y el formulario público de contacto.
- **`rateLimit`** — la clave es la IP de Cloudflare (no `X-Forwarded-For`
  falsificable), el binding compartido manda sobre el contador en memoria y
  cada formulario cuenta por separado.
- **`repoHygiene`** — sin secretos en el código, ni en `vars` de
  `wrangler.jsonc`; sin `eval`/SQL concatenado; sin cron, colas ni Durable
  Objects; sin rastro del login por contraseña.
- **`integration/injection`** — cargas de inyección SQL en proyectos,
  contacto y comentarios contra SQLite de verdad: las tablas siguen ahí y el
  valor vuelve idéntico.
- **`integration/concurrency`** — 20 altas simultáneas con el mismo slug: una
  gana y 19 son 409 (lo garantiza el índice único, no el código).

### Hallazgos que esta suite corrigió

Al escribirla aparecieron fallos reales, ya arreglados (historial; el detalle
de la auditoría está en [`legacy-v2/00-auditoria.md`](./legacy-v2/00-auditoria.md)):

1. `errorHandler` estaba registrado como middleware y **nunca atrapaba nada**:
   Hono manda las excepciones a `onError` antes. Los 401/403/500 salían en
   texto plano. Ahora se registra con `app.onError` y hay un `notFound` JSON.
2. `link_repo`, `link_web` y `video_url` aceptaban `javascript:` y `data:`
   (XSS almacenado si el sitio los pone en un `href`). Ahora solo `http(s)`.
3. Las claves de imagen aceptaban `..`, esquemas y `//host`. Ahora se validan.
4. `parseId` aceptaba `""`, `1e3`, `0x10`, `" 1"` y negativos.
5. Un JWT de Access sin `exp` nunca caducaba. Ahora se exige.
6. El slug no tenía longitud máxima.
7. `zod` 4.6.5 tenía una vulnerabilidad alta (memoria con colecciones
   grandes): actualizado a 4.6.7.

## Pipelines (`.github/workflows/`)

| Archivo          | Cuándo                                  | Qué hace                                                                                                                                                           |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci-dev.yml`     | PR hacia `dev`                          | `checks.yml` (auditoría informativa)                                                                                                                               |
| `ci-main.yml`    | PR hacia `main` y push a `main`         | `checks.yml` (auditoría **obligatoria**)                                                                                                                           |
| `checks.yml`     | reutilizable                            | Biome sin escribir, `tsc`, deriva de migraciones, unitarias+seguridad+propiedades con cobertura, integración con D1 real, `wrangler deploy --dry-run`, `bun audit` |
| `security.yml`   | PR a `dev`/`main`, push a `main`, lunes | CodeQL, gitleaks, revisión de dependencias nuevas, auditoría semanal                                                                                               |
| `dependabot.yml` | semanal                                 | PRs agrupados de dependencias y de acciones, hacia `dev`                                                                                                           |

Ningún job necesita secretos de Cloudflare: la D1 de las pruebas es Miniflare y
el empaquetado usa `--dry-run`.

### Cerrar la puerta (una sola vez, en GitHub)

Sin esto el CI avisa pero no impide nada:

1. **Settings → Branches → Add rule** para `main` (y otra para `dev`).
2. Marca _Require a pull request before merging_ y _Require status checks to
   pass_. Elige: `checks / Lint, tipos y migraciones`, `checks / Unitarias,
   seguridad y propiedades`, `checks / Integración (D1 real en memoria)`,
   `checks / Empaquetado del Worker` y, en `main`, `checks / Auditoría de
   dependencias`, `CodeQL` y `Escaneo de secretos (gitleaks)`.
3. Activa _Do not allow bypassing the above settings_.

### Despliegue (Cloudflare Workers Builds)

En el proyecto del Worker → Settings → Build:

- **Rama de producción:** `main`. Apaga los builds de las demás ramas.
- **Comando de build:** vacío.
- **Comando de deploy:** `bunx wrangler deploy`.

El deploy **no aplica migraciones**. Si un PR toca `drizzle/`, corre
`bun run db:migrate:remote` **antes** de mergear a `main` (las migraciones
deben ser compatibles con el código anterior, porque durante unos segundos
conviven).

## Qué no cubre

- Cloudflare Access de punta a punta: el JWT se simula con una llave propia.
  Ese tramo solo se puede probar a mano contra el Worker desplegado.
- Carga o denegación de servicio: el límite real lo imponen Cloudflare y el
  binding de rate limiting, no esta suite.
- Mutation testing: Stryker no soporta el runner de bun.
