/**
 * Prueba de humo contra un D1 LOCAL de verdad (Miniflare), sin servidor ni
 * puertos: carga la app con el binding real y recorre lecturas y un ciclo de
 * escritura. Los tests de `bun test` usan una base falsa; esto es lo que
 * detecta problemas propios de D1/SQLite.
 *
 * Antes:  bun run db:migrate:local  (y opcionalmente cargar datos)
 * Uso:    bun run smoke:d1
 */
import { getPlatformProxy } from "wrangler";
import type { Bindings } from "../src/env.js";
import app from "../src/index.js";
import { adminAuthed, authed, TEST_ENV } from "../tests/support/helpers.js";

const proxy = await getPlatformProxy<Pick<Bindings, "DB" | "MEDIA">>({
	configPath: "wrangler.jsonc",
});
const env = {
	...TEST_ENV,
	DB: proxy.env.DB,
	MEDIA: proxy.env.MEDIA,
} as Bindings;

const call = (path: string, init?: RequestInit) => app.request(path, init, env);

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
	console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
	if (!ok) {
		failures++;
		if (detail !== undefined)
			console.log("     ", JSON.stringify(detail).slice(0, 300));
	}
};

const json = async (res: Response) =>
	(await res.json()) as { data?: any; message?: string };

// --- lecturas publicas ---
for (const path of [
	"projects",
	"experiences",
	"education",
	"skills",
	"about",
]) {
	const res = await call(`/api/${path}?currentLocale=es`, authed());
	check(`GET /api/${path}`, res.status === 200, res.status);
}
const comments = await call("/api/comments", authed());
check("GET /api/comments", comments.status === 200, comments.status);

const en = await json(await call("/api/projects?currentLocale=en", authed()));
const rows = en.data?.rows ?? [];
check("proyectos publicados leidos de D1", rows.length > 0, rows.length);
check(
	"cada proyecto trae gallery/images_topics como listas",
	rows.every(
		(r: any) => Array.isArray(r.gallery) && Array.isArray(r.images_topics),
	),
);

// --- ciclo de escritura del CMS ---
const slug = `smoke-${Date.now()}`;
const body = {
	slug,
	category: "frontend",
	card_image: "projects/smoke.webp",
	title_default: "Humo",
	summary_default: "Resumen",
	description_default: "Descripcion larga",
	images_topics: ["react"],
	translations: [{ locale: "en", title: "Smoke" }],
};

const created = await call(
	"/api/projects",
	await adminAuthed({ method: "POST", body: JSON.stringify(body) }),
);
const createdBody = await json(created);
check("POST /api/projects crea (201)", created.status === 201, createdBody);
const id = createdBody.data?.project_id;

const dup = await call(
	"/api/projects",
	await adminAuthed({ method: "POST", body: JSON.stringify(body) }),
);
check("slug repetido responde 409", dup.status === 409, dup.status);

const asEn = await json(await call("/api/projects?currentLocale=en", authed()));
const mine = (asEn.data?.rows ?? []).find((r: any) => r.slug === slug);
check(
	"la traduccion en se resuelve desde la misma fila",
	mine?.title === "Smoke",
	mine,
);

const updated = await call(
	`/api/projects/${id}`,
	await adminAuthed({
		method: "PUT",
		body: JSON.stringify({ ...body, status: "draft" }),
	}),
);
check(
	"PUT /api/projects/:id actualiza",
	updated.status === 200,
	updated.status,
);
const afterDraft = await json(
	await call("/api/projects?currentLocale=es", authed()),
);
check(
	"un borrador no aparece en el sitio publico",
	!(afterDraft.data?.rows ?? []).some((r: any) => r.slug === slug),
);
const admin = await json(
	await call("/api/projects/admin", await adminAuthed()),
);
check(
	"pero el CMS lo ve",
	(admin.data ?? []).some((r: any) => r.slug === slug && r.status === "draft"),
);

const deleted = await call(
	`/api/projects/${id}`,
	await adminAuthed({ method: "DELETE" }),
);
check("DELETE /api/projects/:id", deleted.status === 200, deleted.status);

// --- about (upsert) y contacto sin mensaje ---
const about = await call(
	"/api/about",
	await adminAuthed({
		method: "PUT",
		body: JSON.stringify({
			image: "about/me.webp",
			title_card_default: "Dev",
			subtitle_default: "Quien soy",
			description_default: "Texto",
			translations: [{ locale: "en", title_card: "Developer" }],
		}),
	}),
);
check("PUT /api/about (upsert)", about.status === 200, await json(about));
const aboutEn = await json(await call("/api/about?currentLocale=en", authed()));
check(
	"GET /api/about resuelve el idioma",
	aboutEn.data?.title_card === "Developer",
	aboutEn,
);

const contact = await call(
	"/api/contact-messages",
	authed({
		method: "POST",
		headers: { "x-forwarded-for": "198.51.100.200" },
		body: JSON.stringify({
			name: "Ana",
			email: "ana@example.com",
			phone: "+52 55 1234 5678",
		}),
	}),
);
check(
	"POST /api/contact-messages sin mensaje (201)",
	contact.status === 201,
	await json(contact),
);

// --- bandeja de contacto ---
const unread = await json(
	await call("/api/contact-messages/unread-count", await adminAuthed()),
);
check(
	"unread-count cuenta el mensaje nuevo",
	(unread.data?.unread ?? 0) >= 1,
	unread,
);
const inbox = await json(
	await call("/api/contact-messages?status=unread", await adminAuthed()),
);
const mineMsg = (inbox.data as any[] | undefined)?.find(
	(m) => m.email === "ana@example.com",
);
check(
	"?status=unread lo trae, con more_information nulo",
	mineMsg && mineMsg.more_information === null,
	mineMsg,
);
const read = await call(
	`/api/contact-messages/${mineMsg?.message_id}`,
	await adminAuthed({
		method: "PUT",
		body: JSON.stringify({ status: "replied" }),
	}),
);
const readBody = await json(read);
check(
	"marcar replied guarda replied_at",
	read.status === 200 && !!readBody.data?.replied_at,
	readBody,
);
const afterRead = await json(
	await call("/api/contact-messages?status=unread", await adminAuthed()),
);
check(
	"ya no sale en los sin leer",
	!(afterRead.data as any[]).some((m) => m.message_id === mineMsg?.message_id),
);
const gone = await call(
	`/api/contact-messages/${mineMsg?.message_id}`,
	await adminAuthed({ method: "DELETE" }),
);
check("DELETE /api/contact-messages/:id", gone.status === 200, gone.status);

await proxy.dispose();
console.log(failures === 0 ? "\nTodo bien." : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
