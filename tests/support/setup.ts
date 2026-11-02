import { mock } from "bun:test";
import { fakeDb } from "./fakeDb.js";

// Registrado como preload (ver bunfig.toml) para que corra ANTES de que
// cualquier archivo de test importe src/index.ts - src/index.ts importa
// las rutas, que importan los controllers, que importan src/lib/db.ts de
// forma estatica (top-level), asi que el mock tiene que existir antes de
// ese primer import o ya es tarde (db.ts ya habria intentado conectar a
// Turso real, y de hecho tronaria sin TURSO_DATABASE_URL/TURSO_AUTH_TOKEN
// reales en el entorno de test).
mock.module("../../src/lib/db.js", () => ({ createDb: () => fakeDb }));

// Marca para que las pruebas de integracion (D1 real) fallen con un mensaje
// claro si alguien las corre con este preload: usa `bun run test:integration`.
(globalThis as { __DB_MOCKED__?: boolean }).__DB_MOCKED__ = true;
