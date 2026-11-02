import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	getInsertCalls,
	resetFakeDbCalls,
	setFakeDbResult,
} from "../support/fakeDb.js";
import { adminAuthed, app, authed, uniqueIp } from "../support/helpers.js";

/**
 * Entradas hostiles contra los endpoints que escriben. Todas las que no son
 * validas deben cortarse con 400 ANTES de tocar la base (se comprueba que no
 * hubo ningun insert) y nunca terminar en 500.
 */
const validProject = {
	slug: "mi-proyecto",
	category: "frontend",
	card_image: "projects/mi-proyecto.webp",
	title_default: "Titulo",
	summary_default: "Resumen",
	description_default: "Descripcion",
};

const post = async (body: unknown, raw = false) =>
	app.request(
		"/api/projects",
		await adminAuthed({
			method: "POST",
			body: raw ? (body as string) : JSON.stringify(body),
		}),
	);

// El historial del doble de base es compartido por TODOS los archivos de
// prueba: se vacia tambien antes de cada test, porque segun el orden en que el
// runner cargue los archivos (distinto en Linux) llegan inserts de otro archivo.
beforeEach(() => {
	resetFakeDbCalls();
	setFakeDbResult([{ project_id: 1, ...validProject }]);
});
afterEach(() => resetFakeDbCalls());

const expectRejectedBeforeDb = async (
	res: Awaited<ReturnType<typeof post>>,
) => {
	expect(res.status).toBe(400);
	expect((await res.json()).success).toBe(false);
	expect(getInsertCalls()).toHaveLength(0);
};

describe("cuerpo mal formado", () => {
	it("JSON roto", async () => {
		const res = await post("{not json", true);
		expect(res.status).toBe(400);
		expect(getInsertCalls()).toHaveLength(0);
	});

	it("cuerpo vacio", async () => {
		await expectRejectedBeforeDb(await post("", true));
	});

	for (const [name, value] of [
		["null", null],
		["un numero", 42],
		["un texto", "hola"],
		["una lista", []],
		["un booleano", true],
	] as const) {
		it(`${name} en lugar de un objeto`, async () => {
			await expectRejectedBeforeDb(await post(value));
		});
	}

	it("el objeto vacio indica que campos faltan sin exponer internos", async () => {
		const res = await post({});
		expect(res.status).toBe(400);
		const text = JSON.stringify(await res.json());
		expect(text).not.toMatch(/drizzle|sqlite|stack|node_modules/i);
	});
});

describe("slug", () => {
	const bad = [
		"Mayusculas",
		"con espacios",
		"../../etc/passwd",
		"a/b",
		"a\\b",
		"-empieza",
		"termina-",
		"doble--guion",
		"con_guion_bajo",
		"acentó",
		"emoji-😀",
		"'; DROP TABLE projects;--",
		"<script>",
		"a%2fb",
		"a\u0000b",
		"a\nb",
		"",
		" ",
		"a".repeat(101),
	];
	for (const slug of bad) {
		it(`rechaza ${JSON.stringify(slug.slice(0, 30))}`, async () => {
			await expectRejectedBeforeDb(await post({ ...validProject, slug }));
		});
	}

	it("acepta un slug normal", async () => {
		expect((await post(validProject)).status).toBe(201);
	});
});

describe("URLs: solo http(s)", () => {
	const bad = [
		"javascript:alert(document.cookie)",
		"JaVaScRiPt:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"vbscript:msgbox(1)",
		"file:///etc/passwd",
		"ftp://example.com/x",
		"//evil.com",
		"no-es-url",
	];
	for (const field of ["link_repo", "link_web", "video_url"]) {
		for (const url of bad) {
			it(`${field} rechaza ${url.slice(0, 28)}`, async () => {
				await expectRejectedBeforeDb(
					await post({ ...validProject, [field]: url }),
				);
			});
		}
	}

	it("acepta https", async () => {
		const res = await post({
			...validProject,
			link_repo: "https://github.com/muke78/Portafolio",
			link_web: "https://khelde.com",
		});
		expect(res.status).toBe(201);
	});
});

describe("claves de imagen (R2): nunca rutas ni URLs", () => {
	const bad = [
		"../secreto.png",
		"projects/../../secreto.png",
		"//evil.com/x.png",
		"https://evil.com/x.png",
		"javascript:alert(1)",
		"projects\\a.png",
		"projects/a\u0000.png",
		"projects/a b.png".replace(" ", "\n"),
	];
	for (const key of bad) {
		it(`card_image rechaza ${JSON.stringify(key.slice(0, 30))}`, async () => {
			await expectRejectedBeforeDb(
				await post({ ...validProject, card_image: key }),
			);
		});
		it(`gallery rechaza ${JSON.stringify(key.slice(0, 30))}`, async () => {
			await expectRejectedBeforeDb(
				await post({ ...validProject, gallery: [key] }),
			);
		});
	}

	it("acepta claves normales", async () => {
		const res = await post({
			...validProject,
			card_image: "projects/a-b_c.webp",
			gallery: ["projects/g1.webp", "projects/sub/g2.png"],
		});
		expect(res.status).toBe(201);
	});
});

describe("numeros y tipos", () => {
	const bad: [string, Record<string, unknown>][] = [
		["sort_order decimal", { sort_order: 1.5 }],
		["sort_order enorme", { sort_order: 1e308 }],
		["sort_order texto", { sort_order: "1; DROP TABLE" }],
		["featured como texto", { featured: "true" }],
		["category fuera de lista", { category: "admin" }],
		["status fuera de lista", { status: "deleted" }],
		["gallery no lista", { gallery: "projects/a.webp" }],
		["gallery con objetos", { gallery: [{ $ne: 1 }] }],
		["images_topics con numeros", { images_topics: [1, 2] }],
		["titulo como objeto", { title_default: { $gt: "" } }],
		["titulo vacio", { title_default: "" }],
		["traduccion con idioma inventado", { translations: [{ locale: "xx" }] }],
		[
			"traduccion con idioma repetido",
			{ translations: [{ locale: "en" }, { locale: "en" }] },
		],
	];
	for (const [name, patch] of bad) {
		it(`rechaza ${name}`, async () => {
			await expectRejectedBeforeDb(await post({ ...validProject, ...patch }));
		});
	}
});

describe("asignacion masiva y contaminacion de prototipos", () => {
	it("ignora campos que el cliente no debe fijar", async () => {
		const res = await post({
			...validProject,
			project_id: 999,
			id: 999,
			created_at: "1999-01-01",
			updated_at: "1999-01-01",
			is_admin: true,
			role: "admin",
		});
		expect(res.status).toBe(201);
		const inserted = getInsertCalls().at(-1) as Record<string, unknown>;
		for (const k of [
			"project_id",
			"id",
			"created_at",
			"updated_at",
			"is_admin",
			"role",
		]) {
			expect(inserted).not.toHaveProperty(k);
		}
	});

	it("`__proto__` en el cuerpo no contamina Object.prototype", async () => {
		const body = `{"slug":"mi-proyecto","category":"frontend","card_image":"projects/a.webp","title_default":"t","summary_default":"s","description_default":"d","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}`;
		await post(body, true);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		const inserted = getInsertCalls().at(-1) as
			| Record<string, unknown>
			| undefined;
		if (inserted) expect(inserted).not.toHaveProperty("polluted");
	});

	it("`__proto__` como idioma de traduccion se rechaza", async () => {
		await expectRejectedBeforeDb(
			await post({
				...validProject,
				translations: [{ locale: "__proto__", title: "x" }],
			}),
		);
		expect(({} as Record<string, unknown>).title).toBeUndefined();
	});
});

describe("identificadores en la ruta", () => {
	const badIds = [
		"abc",
		"1.5",
		"-1",
		"0",
		"1e3",
		"0x10",
		" 1",
		"1 ",
		"+1",
		"1;DROP TABLE projects",
		"1%20OR%201=1",
		"99999999999999999999",
		"NaN",
		"Infinity",
		"%00",
	];
	for (const id of badIds) {
		it(`DELETE /projects/${id} -> 400`, async () => {
			const res = await app.request(
				`/api/projects/${encodeURIComponent(id)}`,
				await adminAuthed({ method: "DELETE" }),
			);
			expect(res.status).toBe(400);
		});
	}

	it("un id valido llega al controlador", async () => {
		setFakeDbResult([{ project_id: 7 }]);
		const res = await app.request(
			"/api/projects/7",
			await adminAuthed({ method: "DELETE" }),
		);
		expect(res.status).toBe(200);
	});
});

describe("parametros de consulta", () => {
	const payloads = [
		"' OR 1=1 --",
		"es' UNION SELECT * FROM sqlite_master--",
		"<script>alert(1)</script>",
		"../../etc/passwd",
		"%00",
		"x".repeat(5000),
	];
	for (const value of payloads) {
		it(`currentLocale=${value.slice(0, 24)} no rompe la API`, async () => {
			setFakeDbResult([]);
			const res = await app.request(
				`/api/projects?currentLocale=${encodeURIComponent(value)}`,
				authed(),
			);
			expect([200, 400]).toContain(res.status);
		});
	}

	it("currentLocale repetido toma un valor, no falla", async () => {
		setFakeDbResult([]);
		const res = await app.request(
			"/api/projects?currentLocale=en&currentLocale=fr",
			authed(),
		);
		expect([200, 400]).toContain(res.status);
	});

	it("?status invalido en la bandeja -> 400", async () => {
		const res = await app.request(
			"/api/contact-messages?status=read'%20OR%201=1",
			await adminAuthed(),
		);
		expect(res.status).toBe(400);
	});
});

describe("formulario publico de contacto", () => {
	const base = {
		name: "Ana",
		email: "ana@example.com",
		phone: "+52 55 1234 5678",
	};
	const send = (body: unknown) =>
		app.request(
			"/api/contact-messages",
			authed({
				method: "POST",
				body: JSON.stringify(body),
				headers: { "x-forwarded-for": uniqueIp() },
			}),
		);

	const bad: [string, Record<string, unknown>][] = [
		["correo sin dominio", { email: "ana@" }],
		["correo con espacios", { email: "ana @example.com" }],
		[
			"correo con salto de linea (inyeccion de cabeceras)",
			{ email: "a@b.com\nBcc: x@y.com" },
		],
		["nombre de 101 caracteres", { name: "n".repeat(101) }],
		["nombre vacio", { name: "" }],
		["telefono corto", { phone: "123" }],
		["telefono de 21 caracteres", { phone: "1".repeat(21) }],
		["mensaje de mas de 1000", { more_information: "m".repeat(1001) }],
		[
			"status fijado por el cliente se ignora, no se acepta otro tipo",
			{ name: { $ne: "" } },
		],
	];
	for (const [name, patch] of bad) {
		it(`rechaza ${name}`, async () => {
			const res = await send({ ...base, ...patch });
			expect(res.status).toBe(400);
		});
	}

	it("el cliente no puede fijar status ni replied_at", async () => {
		setFakeDbResult([{ message_id: 1 }]);
		const res = await send({
			...base,
			status: "replied",
			replied_at: "2020-01-01",
			message_id: 5,
		});
		expect(res.status).toBe(201);
		const inserted = getInsertCalls().at(-1) as Record<string, unknown>;
		expect(inserted.status).not.toBe("replied");
		expect(inserted).not.toHaveProperty("replied_at");
		expect(inserted).not.toHaveProperty("message_id");
	});
});
