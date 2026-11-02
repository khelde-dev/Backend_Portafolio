import { defineConfig } from "drizzle-kit";

// Solo genera las migraciones SQL (carpeta ./drizzle). Se aplican a D1 con
// `wrangler d1 migrations apply` (ver package.json), no con drizzle-kit.
export default defineConfig({
	out: "./drizzle",
	schema: "./src/schemas/",
	dialect: "sqlite",
});
