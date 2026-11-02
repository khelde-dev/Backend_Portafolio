import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";
import { createDb } from "../lib/db.js";

export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
	c.set("db", createDb(c.env));
	await next();
});
