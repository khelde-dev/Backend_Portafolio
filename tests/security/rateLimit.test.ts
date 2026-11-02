import { beforeEach, describe, expect, it } from "bun:test";
import { setFakeDbResult } from "../support/fakeDb.js";
import { app, authed } from "../support/helpers.js";

/**
 * El limite de peticiones protege los dos formularios publicos del spam y de
 * rellenar la base. Se prueba el contrato de seguridad: la clave es la IP real
 * de Cloudflare (no una cabecera que el cliente pueda falsificar) y el binding
 * compartido manda cuando existe.
 */
const contact = {
	name: "Ana",
	email: "ana@example.com",
	phone: "+52 55 1234 5678",
};

const send = (headers: Record<string, string>, env = {}) =>
	app.request(
		"/api/contact-messages",
		authed({ method: "POST", body: JSON.stringify(contact), headers }),
		env,
	);

let n = 0;
const freshIp = () => `192.0.2.${++n}`;

beforeEach(() => setFakeDbResult([{ message_id: 1 }]));

describe("limite en memoria (pruebas / sin binding)", () => {
	it("bloquea la sexta peticion en la ventana y responde JSON", async () => {
		const ip = freshIp();
		const statuses: number[] = [];
		for (let i = 0; i < 6; i++) {
			statuses.push((await send({ "cf-connecting-ip": ip })).status);
		}
		expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
		expect(statuses[5]).toBe(429);

		const res = await send({ "cf-connecting-ip": ip });
		expect(await res.json()).toEqual({
			success: false,
			message: "Too many requests, try again later",
		});
	});

	it("no se evade cambiando X-Forwarded-For si hay cf-connecting-ip", async () => {
		const ip = freshIp();
		let last = 0;
		for (let i = 0; i < 8; i++) {
			last = (
				await send({
					"cf-connecting-ip": ip,
					"x-forwarded-for": `10.0.0.${i}`,
				})
			).status;
		}
		expect(last).toBe(429);
	});

	it("otra IP real no hereda el bloqueo", async () => {
		const blocked = freshIp();
		for (let i = 0; i < 6; i++) await send({ "cf-connecting-ip": blocked });
		expect((await send({ "cf-connecting-ip": freshIp() })).status).toBe(201);
	});

	it("cada formulario cuenta por separado", async () => {
		const ip = freshIp();
		for (let i = 0; i < 6; i++) await send({ "cf-connecting-ip": ip });
		const comment = await app.request(
			"/api/comments",
			authed({
				method: "POST",
				body: JSON.stringify({}),
				headers: { "cf-connecting-ip": ip },
			}),
		);
		expect(comment.status).toBe(400); // pasa el limite; falla la validacion
	});

	it("una peticion con datos invalidos tambien cuenta", async () => {
		const ip = freshIp();
		let last = 0;
		for (let i = 0; i < 7; i++) {
			last = (
				await app.request(
					"/api/contact-messages",
					authed({
						method: "POST",
						body: "{}",
						headers: { "cf-connecting-ip": ip },
					}),
				)
			).status;
		}
		expect(last).toBe(429);
	});
});

describe("binding de Cloudflare (produccion)", () => {
	const binding = (success: boolean, seen: string[] = []) => ({
		limit: async ({ key }: { key: string }) => {
			seen.push(key);
			return { success };
		},
	});

	it("manda sobre el contador en memoria: rechaza si el binding dice que no", async () => {
		const res = await send(
			{ "cf-connecting-ip": freshIp() },
			{ RL_PUBLIC_WRITE: binding(false) },
		);
		expect(res.status).toBe(429);
	});

	it("deja pasar si el binding dice que si", async () => {
		const res = await send(
			{ "cf-connecting-ip": freshIp() },
			{ RL_PUBLIC_WRITE: binding(true) },
		);
		expect(res.status).toBe(201);
	});

	it("la clave que consulta incluye la ruta y la IP de Cloudflare", async () => {
		const seen: string[] = [];
		const ip = freshIp();
		await send(
			{ "cf-connecting-ip": ip, "x-forwarded-for": "6.6.6.6" },
			{ RL_PUBLIC_WRITE: binding(true, seen) },
		);
		expect(seen).toEqual([`/api/contact-messages:${ip}`]);
	});
});

describe("alcance", () => {
	it("las lecturas no tienen limite", async () => {
		setFakeDbResult([]);
		for (let i = 0; i < 12; i++) {
			const res = await app.request(
				"/api/comments",
				authed({ headers: { "cf-connecting-ip": "192.0.2.250" } }),
			);
			expect(res.status).toBe(200);
		}
	});
});
