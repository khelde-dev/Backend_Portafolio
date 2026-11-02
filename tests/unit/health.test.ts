import { describe, expect, it } from "bun:test";
import { setFakeDbResult } from "../support/fakeDb.js";
import { app, authed } from "../support/helpers.js";

describe("GET /api (health check)", () => {
	it("es publico, sin bearer token", async () => {
		const res = await app.request("/api");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.name).toBe("Backend_Portafolio");
	});
});

describe("Bearer auth", () => {
	it("401 sin Authorization header", async () => {
		const res = await app.request("/api/comments");
		expect(res.status).toBe(401);
	});

	it("401 con token incorrecto", async () => {
		const res = await app.request("/api/comments", {
			headers: { Authorization: "Bearer wrong-token" },
		});
		expect(res.status).toBe(401);
	});

	it("200 con el token correcto", async () => {
		setFakeDbResult([]);
		const res = await app.request("/api/comments", authed());
		expect(res.status).toBe(200);
	});
});
