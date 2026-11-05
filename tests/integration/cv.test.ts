import { beforeEach, describe, expect, it } from "bun:test";
import realApp from "../../src/index.js";
import { useRealD1 } from "../support/d1.js";
import { adminAuthed, authed } from "../support/helpers.js";
import { TINY_WEBP } from "../support/webp.js";

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

/** Un PDF minimo: cabecera, un objeto y el cierre. */
const PDF = new TextEncoder().encode(
	"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

const SITE_COPY = {
	hero_image: "site/abc.webp",
	hero_image_alt_default: "Retrato",
	hero_label_default: "Desarrollador",
	hero_lead_default: "Presentacion",
	manifesto_text_default: "Manifiesto",
	meta_description_default: "Descripcion",
	translations: [],
};

const putSiteCopy = async (body: unknown = SITE_COPY) =>
	call(
		"/api/site-copy",
		await adminAuthed({ method: "PUT", body: JSON.stringify(body) }),
	);

const upload = async (
	body: BodyInit | Uint8Array = PDF,
	{ type = "application/pdf" } = {},
) =>
	call(
		"/api/cv",
		await adminAuthed({
			method: "POST",
			headers: { "Content-Type": type },
			body: body as BodyInit,
		}),
	);

const current = async () =>
	json(await call("/api/cv", await adminAuthed({ method: "GET" })));

const remove = async () =>
	call("/api/cv", await adminAuthed({ method: "DELETE" }));

const cvKeys = async () =>
	(await d1.env.MEDIA.list({ prefix: "cv/" })).objects.map((o) => o.key);

describe("subida del curriculum", () => {
	it("sin textos del sitio no hay donde guardar la clave: 409 y nada queda en R2", async () => {
		const res = await upload();
		expect(res.status).toBe(409);
		expect(await cvKeys()).toEqual([]);
	});

	it("sube un PDF: clave del servidor, cabeceras y metadatos", async () => {
		await putSiteCopy();
		const res = await upload();
		expect(res.status).toBe(201);
		const { data } = await json(res);
		expect(data.key).toMatch(/^cv\/CV-Erick-Gonzalez-[0-9a-f]{8}\.pdf$/);
		expect(data.size).toBe(PDF.length);
		// El entorno de pruebas no define PUBLIC_MEDIA_URL: no hay URL publica.
		expect(data.url).toBeNull();

		const stored = await d1.env.MEDIA.head(data.key);
		expect(stored?.httpMetadata?.contentType).toBe("application/pdf");
		expect(stored?.httpMetadata?.contentDisposition).toBe(
			'inline; filename="CV-Erick-Gonzalez.pdf"',
		);
		expect(stored?.httpMetadata?.cacheControl).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(stored?.customMetadata?.uploadedBy).toBe("admin@example.com");
	});

	it("con PUBLIC_MEDIA_URL devuelve la URL publica", async () => {
		await putSiteCopy();
		const res = await realApp.request(
			"/api/cv",
			await adminAuthed({
				method: "POST",
				headers: { "Content-Type": "application/pdf" },
				body: PDF as BodyInit,
			}),
			{ ...d1.env, PUBLIC_MEDIA_URL: "https://media.example.dev/" },
		);
		const { data } = await json(res);
		expect(data.url).toBe(`https://media.example.dev/${data.key}`);
	});

	it("el sitio recibe la clave y GET /cv la devuelve con tamano y fecha", async () => {
		await putSiteCopy();
		const { data } = await json(await upload());

		const site = await json(
			await call("/api/site-copy?currentLocale=es", authed()),
		);
		expect(site.data.cv_pdf).toBe(data.key);

		const now = await current();
		expect(now.data).toMatchObject({ key: data.key, size: PDF.length });
		expect(typeof now.data.uploaded).toBe("string");
	});

	it("sin PDF cargado, el sitio recibe null y GET /cv tambien", async () => {
		await putSiteCopy();
		const site = await json(
			await call("/api/site-copy?currentLocale=es", authed()),
		);
		expect(site.data.cv_pdf).toBeNull();
		expect((await current()).data).toBeNull();
	});

	it("subir el CV no cambia updated_at de los textos (no provoca 409 en el formulario)", async () => {
		await putSiteCopy();
		const before = await json(
			await call("/api/site-copy/admin", await adminAuthed()),
		);
		await upload();
		const after = await json(
			await call("/api/site-copy/admin", await adminAuthed()),
		);
		expect(after.data.updated_at).toBe(before.data.updated_at);
		expect(after.data.cv_pdf_key).toMatch(/^cv\//);
	});

	it("guardar los textos no borra el PDF", async () => {
		await putSiteCopy();
		const { data } = await json(await upload());
		await putSiteCopy({ ...SITE_COPY, hero_label_default: "Otro" });
		expect((await current()).data.key).toBe(data.key);
	});

	it("subir otro PDF reemplaza al anterior y borra el objeto viejo", async () => {
		await putSiteCopy();
		const first = (await json(await upload())).data.key;
		const second = (await json(await upload())).data.key;
		expect(second).not.toBe(first);
		expect(await cvKeys()).toEqual([second]);
		expect((await current()).data.key).toBe(second);
	});

	it("rechaza lo que no se declara application/pdf (415)", async () => {
		await putSiteCopy();
		for (const type of ["image/webp", "application/json", "text/html"]) {
			expect((await upload(PDF, { type })).status).toBe(415);
		}
		expect(await cvKeys()).toEqual([]);
	});

	it("rechaza un archivo que no es PDF aunque diga serlo (400)", async () => {
		await putSiteCopy();
		const html = new TextEncoder().encode(
			"<html><script>alert(1)</script></html>",
		);
		const zip = Uint8Array.from([
			0x50,
			0x4b,
			0x03,
			0x04,
			...new Array(40).fill(0),
		]);
		for (const body of [TINY_WEBP, html, zip]) {
			const res = await upload(body);
			expect(res.status).toBe(400);
			expect((await json(res)).message).toMatch(/PDF/);
		}
		expect(await cvKeys()).toEqual([]);
	});

	it("rechaza un archivo vacio y uno de mas de 5 MB (413)", async () => {
		await putSiteCopy();
		expect((await upload(new Uint8Array(0))).status).toBe(400);
		const big = new Uint8Array(5 * 1024 * 1024 + 10);
		big.set(PDF);
		const res = await upload(big);
		expect(res.status).toBe(413);
		expect((await json(res)).message).toMatch(/5 MB/);
		expect(await cvKeys()).toEqual([]);
	});

	it("exige Access (401): el bearer solo no basta", async () => {
		await putSiteCopy();
		const res = await call(
			"/api/cv",
			authed({
				method: "POST",
				headers: { "Content-Type": "application/pdf" },
				body: PDF as BodyInit,
			}),
		);
		expect(res.status).toBe(401);
		expect((await call("/api/cv", authed())).status).toBe(401);
		expect((await call("/api/cv", authed({ method: "DELETE" }))).status).toBe(
			401,
		);
		expect(await cvKeys()).toEqual([]);
	});
});

describe("quitar el curriculum", () => {
	it("borra el objeto y deja la clave en null", async () => {
		await putSiteCopy();
		await upload();
		const res = await remove();
		expect(res.status).toBe(200);
		expect(await cvKeys()).toEqual([]);
		expect((await current()).data).toBeNull();
		const site = await json(
			await call("/api/site-copy?currentLocale=es", authed()),
		);
		expect(site.data.cv_pdf).toBeNull();
	});

	it("sin PDF cargado responde 404", async () => {
		await putSiteCopy();
		expect((await remove()).status).toBe(404);
	});
});

describe("el curriculum no es una imagen de la biblioteca", () => {
	it("no aparece en Medios", async () => {
		await putSiteCopy();
		const { data } = await json(await upload());
		const listing = await json(await call("/api/media", await adminAuthed()));
		expect(
			listing.data.objects.some((o: { key: string }) => o.key === data.key),
		).toBe(false);
	});

	it("DELETE /api/media no puede borrarlo (400)", async () => {
		await putSiteCopy();
		const { data } = await json(await upload());
		const res = await call(
			`/api/media/${data.key}`,
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(400);
		expect(await cvKeys()).toEqual([data.key]);
	});
});
