import { beforeEach, describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed, authed } from "../support/helpers.js";
import { TINY_WEBP, vp8x } from "../support/webp.js";

const d1 = useRealD1();

// El bucket de Miniflare es uno por proceso: se vacia para que cada prueba
// empiece sin objetos de las anteriores.
beforeEach(async () => {
	const { objects } = await d1.env.MEDIA.list();
	if (objects.length > 0) await d1.env.MEDIA.delete(objects.map((o) => o.key));
});

// biome-ignore lint/suspicious/noExplicitAny: cuerpos JSON libres en pruebas
const json = async (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) =>
	realApp.request(path, init, d1.env);

const upload = async (
	body: BodyInit | Uint8Array = TINY_WEBP,
	{ type = "image/webp", use = "projects" } = {},
) =>
	call(
		`/api/media?use=${use}`,
		await adminAuthed({
			method: "POST",
			headers: { "Content-Type": type },
			body: body as BodyInit,
		}),
	);

const remove = async (key: string) =>
	call(`/api/media/${key}`, await adminAuthed({ method: "DELETE" }));

const insertProject = (cardImage: string, gallery: string[] = []) =>
	d1.db
		.prepare(
			`INSERT INTO projects (slug, category, card_image, gallery, title_default, summary_default, description_default)
			 VALUES (?, 'frontend', ?, ?, 'Mi proyecto', 'Resumen', 'Descripcion')`,
		)
		.bind(`p-${crypto.randomUUID()}`, cardImage, JSON.stringify(gallery))
		.run();

describe("subida de imagenes", () => {
	it("sube un WebP: clave del servidor, cabeceras de cache y metadatos", async () => {
		const res = await upload();
		expect(res.status).toBe(201);
		const { data } = await json(res);
		expect(data.key).toMatch(/^projects\/[0-9a-f-]{36}\.webp$/);
		expect(data).toMatchObject({ size: TINY_WEBP.length, width: 1, height: 1 });
		// El entorno de pruebas no define PUBLIC_MEDIA_URL: no hay URL publica.
		expect(data.url).toBeNull();

		const stored = await d1.env.MEDIA.head(data.key);
		expect(stored?.httpMetadata?.contentType).toBe("image/webp");
		expect(stored?.httpMetadata?.cacheControl).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(stored?.customMetadata?.uploadedBy).toBe("admin@example.com");
	});

	it("con PUBLIC_MEDIA_URL devuelve la URL publica sin barras repetidas", async () => {
		const res = await realApp.request(
			"/api/media?use=projects",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "image/webp" },
				body: TINY_WEBP as BodyInit,
			}),
			{ ...d1.env, PUBLIC_MEDIA_URL: "https://media.example.dev/" },
		);
		const { data } = await json(res);
		expect(data.url).toBe(`https://media.example.dev/${data.key}`);
	});

	it("la carpeta la elige el cliente, pero solo entre las previstas", async () => {
		expect(
			(await json(await upload(TINY_WEBP, { use: "site" }))).data.key,
		).toMatch(/^site\//);
		expect((await upload(TINY_WEBP, { use: "../etc" })).status).toBe(400);
		expect((await upload(TINY_WEBP, { use: "" })).status).toBe(400);
	});

	it("rechaza lo que no se declara image/webp (415)", async () => {
		expect((await upload(TINY_WEBP, { type: "image/png" })).status).toBe(415);
		expect((await upload(TINY_WEBP, { type: "application/json" })).status).toBe(
			415,
		);
		expect((await upload(TINY_WEBP, { type: "text/html" })).status).toBe(415);
	});

	it("rechaza un PNG, un SVG o texto aunque digan image/webp (400)", async () => {
		const png = Uint8Array.from([
			0x89,
			0x50,
			0x4e,
			0x47,
			0x0d,
			0x0a,
			0x1a,
			0x0a,
			...new Array(60).fill(0),
		]);
		const svg = new TextEncoder().encode(
			"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>",
		);
		for (const body of [
			png,
			svg,
			new TextEncoder().encode("hola".repeat(30)),
		]) {
			const res = await upload(body);
			expect(res.status).toBe(400);
			expect((await json(res)).message).toMatch(/WebP/);
		}
		const listing = await d1.env.MEDIA.list();
		expect(
			listing.objects.filter((o) => o.key.startsWith("projects/")),
		).toHaveLength(0);
	});

	it("rechaza una imagen vacia y una que pasa de 4096 px", async () => {
		expect((await upload(new Uint8Array(0))).status).toBe(400);
		const res = await upload(vp8x(5000, 100));
		expect(res.status).toBe(400);
		expect((await json(res)).message).toMatch(/4096/);
		expect((await upload(vp8x(4096, 4096))).status).toBe(201);
	});

	it("rechaza mas de 2 MB (413) sin guardar nada", async () => {
		const big = new Uint8Array(2 * 1024 * 1024 + 10);
		big.set(vp8x(10, 10));
		const res = await upload(big);
		expect(res.status).toBe(413);
		expect((await json(res)).message).toMatch(/2 MB/);
	});

	it("exige Access (401) y bearer", async () => {
		const noAccess = await call(
			"/api/media?use=projects",
			authed({
				method: "POST",
				headers: { "Content-Type": "image/webp" },
				body: TINY_WEBP as BodyInit,
			}),
		);
		expect(noAccess.status).toBe(401);
		const noBearer = await call("/api/media?use=projects", {
			method: "POST",
			headers: { "Content-Type": "image/webp" },
			body: TINY_WEBP as BodyInit,
		});
		expect(noBearer.status).toBe(401);
	});

	it("el resto del API conserva su tope de 50 KB", async () => {
		const res = await call(
			"/api/comments",
			authed({
				method: "POST",
				body: JSON.stringify({ name: "x", description: "y".repeat(60 * 1024) }),
			}),
		);
		expect(res.status).toBe(413);
	});
});

describe("biblioteca y borrado", () => {
	it("lista las imagenes con donde se usan; la sin uso sale vacia", async () => {
		const used = (await json(await upload())).data.key as string;
		const orphan = (await json(await upload())).data.key as string;
		const legacy = "legacy-test.webp";
		await d1.env.MEDIA.put(legacy, TINY_WEBP);
		await insertProject(used);
		await insertProject(`/${legacy}`);

		const { data } = await json(await call("/api/media", await adminAuthed()));
		const byKey = Object.fromEntries(
			data.objects.map((o: { key: string }) => [o.key, o]),
		);
		expect(byKey[used].usedBy[0]).toMatchObject({
			resource: "projects",
			field: "card_image",
			label: "Mi proyecto",
		});
		expect(byKey[orphan].usedBy).toEqual([]);
		// La clave heredada con "/" inicial coincide con el objeto sin "/".
		expect(byKey[legacy].usedBy).toHaveLength(1);
		expect(data.truncated).toBe(false);
		await d1.env.MEDIA.delete([used, orphan, legacy]);
	});

	it("la galeria cuenta como uso", async () => {
		const key = (await json(await upload())).data.key as string;
		await insertProject("projects/otra.webp", [key]);
		const { data } = await json(await call("/api/media", await adminAuthed()));
		expect(
			data.objects.find((o: { key: string }) => o.key === key).usedBy[0].field,
		).toBe("gallery");
		await d1.env.MEDIA.delete(key);
	});

	it("borrar una imagen en uso es 409 y la lista; la imagen sigue ahi", async () => {
		const key = (await json(await upload())).data.key as string;
		await insertProject(key);
		const res = await remove(key);
		expect(res.status).toBe(409);
		expect((await json(res)).data.usedBy[0].resource).toBe("projects");
		expect(await d1.env.MEDIA.head(key)).not.toBeNull();
		await d1.env.MEDIA.delete(key);
	});

	it("borrar una imagen sin uso la quita; repetir da 404", async () => {
		const key = (await json(await upload())).data.key as string;
		expect((await remove(key)).status).toBe(200);
		expect(await d1.env.MEDIA.head(key)).toBeNull();
		expect((await remove(key)).status).toBe(404);
	});

	it("rechaza claves que se salen del bucket", async () => {
		for (const key of [
			"a/%2E%2E/b.webp",
			"..%2Fsecreto",
			"https%3A%2F%2Fevil.example%2Fx.webp",
			"a%5Cb.webp",
		]) {
			expect([400, 404]).toContain((await remove(key)).status);
		}
	});

	it("listar y borrar exigen Access", async () => {
		expect((await call("/api/media", authed())).status).toBe(401);
		expect(
			(await call("/api/media/a.webp", authed({ method: "DELETE" }))).status,
		).toBe(401);
	});
});
