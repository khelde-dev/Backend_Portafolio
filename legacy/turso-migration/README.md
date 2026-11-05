# Migración Turso → D1 (legacy)

Herramientas de **un solo uso** con las que se pasó el contenido del portafolio
de **Turso (libSQL)** a **Cloudflare D1**. La migración ya se hizo; esta carpeta
se conserva por si hace falta repetirla o consultar cómo se hizo. **No forma
parte del CI ni del tipado** (`tsconfig.json` la excluye).

## Archivos

| Archivo                                        | Qué hace                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `backup-turso.ts`                              | Descarga cada tabla de Turso a un JSON (`backups/turso/<fecha>/`)                                               |
| `tursoToD1.ts`                                 | Convierte ese respaldo al esquema de D1 y arma el SQL (las traducciones pasan a la columna JSON `translations`) |
| `build-d1-import.ts`                           | Lee un respaldo, usa `tursoToD1.ts` y escribe `backups/d1-import.sql`                                           |
| `tursoToD1.test.ts`, `importRoundTrip.test.ts` | Pruebas del convertidor (incluye una vuelta completa contra SQLite real con `fast-check`)                       |

## Cómo repetirlo

La dependencia `@libsql/client` **ya no está** en `package.json`. Instálala solo
para esta tarea:

```bash
bun add -d @libsql/client
# variables en .env: TURSO_DATABASE_URL y TURSO_AUTH_TOKEN
bun run legacy/turso-migration/backup-turso.ts
bun run legacy/turso-migration/build-d1-import.ts backups/turso/<fecha>
bunx wrangler d1 execute DB --remote --file=backups/d1-import.sql   # después de db:migrate:remote
bun remove @libsql/client
```

Las pruebas se corren aparte, con el mismo _preload_ que las unitarias:

```bash
bun test --preload ./tests/support/setup.ts legacy
```

## Aviso

`backups/` contiene nombres y correos reales de comentarios y mensajes. Está en
`.gitignore` y **nunca** debe subirse a GitHub.
