import { afterEach, describe, expect, it } from "bun:test";
import { contactInfoInputSchema } from "../../src/schemas/contactInfo.js";
import { resetFakeDbCalls, setFakeDbResult } from "../support/fakeDb.js";
import { adminAuthed, app, authed } from "../support/helpers.js";

const VALID_BODY = {
	github_url: "https://github.com/muke78",
	linkedin_url: "https://www.linkedin.com/in/alguien/",
	linkedin_name: "Erick Gonzalez",
	phone: "+52 55 1190 9105",
	email: "persona@example.com",
};

const put = async (body: unknown) =>
	app.request(
		"/api/contact-info",
		await adminAuthed({ method: "PUT", body: JSON.stringify(body) }),
	);

afterEach(() => {
	setFakeDbResult([]);
	resetFakeDbCalls();
});

describe("contactInfoInputSchema", () => {
	it("acepta datos validos y normaliza el correo", () => {
		const parsed = contactInfoInputSchema.parse({
			...VALID_BODY,
			email: "  Persona@Example.COM ",
		});
		expect(parsed.email).toBe("persona@example.com");
	});

	it.each([
		["http en vez de https", "http://github.com/x"],
		["otro dominio", "https://evil.example/github.com"],
		["dominio que solo termina igual", "https://notgithub.com/x"],
		["javascript:", "javascript:alert(1)"],
		["no es URL", "github.com/x"],
		["vacio", ""],
	])("GitHub rechaza: %s", (_name, value) => {
		expect(
			contactInfoInputSchema.safeParse({ ...VALID_BODY, github_url: value })
				.success,
		).toBe(false);
	});

	it("GitHub y LinkedIn aceptan sus subdominios", () => {
		expect(
			contactInfoInputSchema.safeParse({
				...VALID_BODY,
				github_url: "https://www.github.com/muke78",
				linkedin_url: "https://mx.linkedin.com/in/x",
			}).success,
		).toBe(true);
	});

	it("LinkedIn solo acepta linkedin.com", () => {
		expect(
			contactInfoInputSchema.safeParse({
				...VALID_BODY,
				linkedin_url: "https://github.com/muke78",
			}).success,
		).toBe(false);
	});

	it.each([
		["sin +", "5511909105"],
		["con letras", "+52 abc 1190"],
		["muy corto", "+52 123"],
		["demasiados digitos", "+52 55 1190 9105 5555 5555"],
		["vacio", ""],
	])("telefono rechaza: %s", (_name, phone) => {
		expect(
			contactInfoInputSchema.safeParse({ ...VALID_BODY, phone }).success,
		).toBe(false);
	});

	it.each(["+52-551-190 9105", "+1 (555) 123-4567", "+525511909105"])(
		"telefono acepta %s",
		(phone) => {
			expect(
				contactInfoInputSchema.safeParse({ ...VALID_BODY, phone }).success,
			).toBe(true);
		},
	);

	it("correo invalido y nombre vacio se rechazan", () => {
		expect(
			contactInfoInputSchema.safeParse({ ...VALID_BODY, email: "no-es-correo" })
				.success,
		).toBe(false);
		expect(
			contactInfoInputSchema.safeParse({ ...VALID_BODY, linkedin_name: "  " })
				.success,
		).toBe(false);
	});
});

describe("GET /api/contact-info", () => {
	it("200 con los datos, sin ids ni fechas", async () => {
		setFakeDbResult([
			{
				contact_id: 1,
				...VALID_BODY,
				created_at: "2026-01-01 00:00:00",
				updated_at: "2026-01-01 00:00:00",
			},
		]);
		const res = await app.request("/api/contact-info", authed());
		expect(res.status).toBe(200);
		expect((await res.json()).data).toEqual(VALID_BODY);
	});

	it("200 con data null si todavia no hay fila", async () => {
		setFakeDbResult([]);
		const res = await app.request("/api/contact-info", authed());
		expect(res.status).toBe(200);
		expect((await res.json()).data).toBeNull();
	});

	it("401 sin el bearer de la app", async () => {
		const res = await app.request("/api/contact-info");
		expect(res.status).toBe(401);
	});
});

describe("/api/contact-info del CMS", () => {
	it("GET /admin devuelve la fila completa", async () => {
		setFakeDbResult([{ contact_id: 1, ...VALID_BODY }]);
		const res = await app.request(
			"/api/contact-info/admin",
			await adminAuthed(),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).data.contact_id).toBe(1);
	});

	it("PUT 401 sin sesion de Access", async () => {
		const res = await app.request(
			"/api/contact-info",
			authed({ method: "PUT", body: JSON.stringify(VALID_BODY) }),
		);
		expect(res.status).toBe(401);
	});

	it("PUT 400 con body invalido", async () => {
		expect((await put({})).status).toBe(400);
		expect(
			(await put({ ...VALID_BODY, github_url: "https://x.example" })).status,
		).toBe(400);
	});

	it("PUT 200 con body valido (upsert)", async () => {
		setFakeDbResult([{ contact_id: 1, ...VALID_BODY }]);
		expect((await put(VALID_BODY)).status).toBe(200);
	});

	it("PUT ignora campos que no son suyos", async () => {
		setFakeDbResult([{ contact_id: 1, ...VALID_BODY }]);
		expect(
			(await put({ ...VALID_BODY, contact_id: 9, isAdmin: true })).status,
		).toBe(200);
	});
});
