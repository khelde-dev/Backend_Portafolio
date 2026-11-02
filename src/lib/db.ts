import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env.js";

/**
 * Una conexion por peticion: en Workers la base llega como binding
 * (`c.env.DB`), no como una URL global. Los controladores reciben el
 * resultado de esta funcion (`c.get("db")`).
 */
export const createDb = (env: Pick<Bindings, "DB">) => drizzle(env.DB);

export type Db = ReturnType<typeof createDb>;
