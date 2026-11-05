# CRUD de `about`/`education`/`skills` — Fase 5a

Cierra el hallazgo de contexto de Fase 5 (plan en
`C:\Users\MikeT\.claude\plans\stateless-humming-pinwheel.md`, repo
Portafolio): el usuario compartió una maqueta real del panel admin
(`admin.html`/`admin.jsx`/`admin.css`) cuyo sidebar lista los módulos que
necesita para editar **todo** el portafolio desde un dashboard — entre
ellos "Acerca de mí", "Educación" y "Habilidades". Al revisar el código
para planear esto se confirmó que ninguno de los tres es un dato hoy:
`SobreMi.tsx`/`Educacion.tsx` (Portafolio) leen texto fijo de
`src/i18n/locales/{es,en,fr}.json` (claves `ABOUTME.*`/`UNIVERSITY.*`),
`Educacion.tsx` solo soporta **una** institución (sin lista), y
`Habilidades.tsx` lee de `src/data/locales/{es,en,fr}/dataTabsAcercaDe*.ts`
(arrays estáticos). Esta fase los convierte en tablas reales en Turso,
editables desde el dashboard igual que `projects`/`experiences`.

## Diseño

Mismo patrón ya establecido en `experiences.ts`/`projects.ts`
(tabla principal con columnas `_default` + tabla `_translations` por
locale, `COALESCE` en el `SELECT` para nunca devolver `null` si falta la
traducción de un locale pedido) — con dos variantes:

- **`about` es un singleton** (una sola persona, un solo perfil):
  `about_id` siempre `1`, sembrado una vez por `scripts/seed-content.ts`.
  La ruta no tiene `POST`/`DELETE` — solo `GET /about` (público, mismo
  bearer token de siempre) y `PUT /about` (admin, sin `:id` en la URL:
  "crear otro" o "borrar el único" no tiene sentido). `UpdateAbout` hace
  un upsert real (`onConflictDoUpdate` sobre `about_id`) para que la
  primera escritura funcione incluso si el seed todavía no corrió.
- **`education`** es una lista (hoy el sitio público solo muestra una
  universidad, pero el diseño no debe limitarlo a una) — CRUD completo,
  mismo shape que `experience`/`experience_translations`. `institution`
  es nullable en la traducción (igual que `work` en
  `experience_translations`): el nombre de una institución normalmente no
  se traduce.
- **`skills`** es una lista de categorías (`images_topics` guardado como
  texto JSON, mismo patrón que `projects.images_topics`, expuesto a la
  API como `string[]` real). Los slugs de iconos no se traducen, solo el
  título de la categoría.

## `scripts/seed-content.ts`

A diferencia de `scripts/seed-admin-user.ts`, esto **no** es interactivo
ni lo corre el usuario a mano — no toca contraseñas ni nada sensible, es
contenido público que ya vive en el repo de Portafolio (texto de
`i18n/locales/*.json` y de `dataTabsAcercaDe*.ts`, copiado a mano a este
script porque son repos separados). Idempotente: si una tabla ya tiene
filas, se omite — se puede re-correr sin duplicar. Corrido una sola vez
contra Turso real en esta fase (`bun run seed:content`):

```
about sembrado (1 fila + 3 traducciones).
education sembrado (1 fila + 3 traducciones).
skills sembrado (11 filas + 33 traducciones).
```

## Hallazgo operativo: acentos y argumentos de shell en Windows

Verificando el CRUD a mano con `curl -d '{"...á..."}'` directo como
argumento en Git Bash (Windows), el texto con tildes/eñes llegó
corrompido a Turso (reemplazado por `�`, U+FFFD) — el argumento se
re-codifica mal antes de que `curl` lo mande, no es un bug de la API. Se
detectó de inmediato (no asumido) volviendo a leer el registro por
`GET`, y se corrigió re-mandando el mismo payload vía `--data-binary @archivo.json`
(un archivo UTF-8 real en disco, nunca un argumento de shell). Anotado
aquí porque es un hallazgo operativo reutilizable: **cualquier prueba
manual con texto acentuado contra esta API en este entorno debe pasar por
archivo, no por argumento de línea de comandos.**

## Verificación

- `bun run typecheck` limpio, `bun test` en verde (75 tests, incluye
  `tests/about.test.ts`, `tests/education.test.ts`, `tests/skills.test.ts`
  con db mockeada).
- CRUD real de punta a punta contra Turso (crear/editar/borrar una
  institución y una categoría de skill de prueba, limpiar después; upsert
  de `about` confirmado). JWT verificado obligatorio en los tres (`PUT
  /about`, `POST/PUT/DELETE /education`, `POST/PUT/DELETE /skills` → 401
  sin `X-Admin-JWT`).
- `GET /about|education|skills?currentLocale=es|en|fr` devuelve el
  contenido migrado y coincide con lo que hoy se ve en el sitio público
  (Fase 5b conecta ese lado — Portafolio sigue leyendo de código estático
  hasta entonces).

## Pendiente (fuera de alcance de esta fase)

- Fase 5b (Portafolio): `SobreMi.tsx`/`Educacion.tsx`/`Habilidades.tsx`
  pasan a hacer fetch a estos endpoints en vez de leer código estático.
- Fase 5c (Portafolio): UI real en el dashboard para estos tres recursos.
