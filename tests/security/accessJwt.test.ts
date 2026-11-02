import { beforeEach, describe, expect, it } from "bun:test";
import { setFakeDbResult } from "../support/fakeDb.js";
import {
	hs256WithPublicKey,
	signedByAttacker,
	tamperPayload,
	unsigned,
} from "../support/forge.js";
import {
	ACCESS_AUD,
	ACCESS_TEAM,
	accessJwt,
	app,
	authed,
	TEST_ENV,
} from "../support/helpers.js";

/**
 * Ataques contra la verificacion del JWT de Cloudflare Access. Cada caso es
 * algo que un atacante sin la llave privada de Cloudflare podria intentar
 * para llegar a las rutas del CMS. TODOS deben terminar en 401 (nunca en 200
 * ni en 500 con detalles internos).
 */
const PROTECTED = "/api/projects/admin";

const withJwt = (token: string | undefined, extra: RequestInit = {}) => {
	const base = authed(extra);
	return token === undefined
		? base
		: {
				...base,
				headers: {
					...(base.headers as Record<string, string>),
					"Cf-Access-Jwt-Assertion": token,
				},
			};
};

const call = (token: string | undefined, env = {}) =>
	app.request(PROTECTED, withJwt(token), env);

const expectRejected = async (res: Awaited<ReturnType<typeof call>>) => {
	expect(res.status).toBe(401);
	const body = await res.json();
	expect(body.success).toBe(false);
	// Nada de pistas sobre el motivo exacto ni de trazas internas.
	expect(JSON.stringify(body)).not.toMatch(/stack|at .*\(|jwt|signature|kid/i);
};

beforeEach(() => setFakeDbResult([]));

describe("sesion de Access valida", () => {
	it("pasa con un JWT bien firmado", async () => {
		expect((await call(await accessJwt())).status).toBe(200);
	});

	it("acepta `aud` como texto o como lista", async () => {
		expect((await call(await accessJwt({ aud: ACCESS_AUD }))).status).toBe(200);
	});
});

describe("ausencia de la sesion", () => {
	it("sin cabecera -> 401", async () => {
		await expectRejected(await call(undefined));
	});

	it("cabecera vacia -> 401", async () => {
		await expectRejected(await call(""));
	});

	it("el bearer del API NO sustituye a la sesion de Access", async () => {
		const res = await app.request(PROTECTED, authed());
		expect(res.status).toBe(401);
	});

	it("una sesion de Access valida SIN el bearer tampoco pasa", async () => {
		const res = await app.request(PROTECTED, {
			headers: {
				"Content-Type": "application/json",
				"Cf-Access-Jwt-Assertion": await accessJwt(),
			},
		});
		expect(res.status).toBe(401);
	});

	it("el JWT en la cabecera Authorization no cuenta", async () => {
		const res = await app.request(PROTECTED, {
			headers: {
				Authorization: `Bearer ${await accessJwt()}`,
				"Content-Type": "application/json",
			},
		});
		expect(res.status).toBe(401);
	});
});

describe("reclamos (claims) manipulados", () => {
	it("expirado", async () => {
		await expectRejected(
			await call(await accessJwt({ exp: Math.floor(Date.now() / 1000) - 60 })),
		);
	});

	it("sin `exp`", async () => {
		await expectRejected(await call(await accessJwt({ exp: undefined })));
	});

	it("`nbf` en el futuro", async () => {
		await expectRejected(
			await call(await accessJwt({ nbf: Math.floor(Date.now() / 1000) + 600 })),
		);
	});

	it("`iat` en el futuro", async () => {
		await expectRejected(
			await call(await accessJwt({ iat: Math.floor(Date.now() / 1000) + 600 })),
		);
	});

	it("audiencia de OTRA aplicacion de Access", async () => {
		await expectRejected(await call(await accessJwt({ aud: ["otra-app"] })));
	});

	it("sin audiencia", async () => {
		await expectRejected(await call(await accessJwt({ aud: undefined })));
	});

	it("audiencia vacia", async () => {
		await expectRejected(await call(await accessJwt({ aud: [] })));
	});

	it("emisor de otro equipo de Cloudflare", async () => {
		await expectRejected(
			await call(await accessJwt({ iss: "https://evil.cloudflareaccess.com" })),
		);
	});

	it("sin emisor", async () => {
		await expectRejected(await call(await accessJwt({ iss: undefined })));
	});

	it("emisor con el mismo prefijo pero distinto host", async () => {
		await expectRejected(
			await call(await accessJwt({ iss: `${ACCESS_TEAM}.evil.com` })),
		);
	});
});

describe("firma y algoritmo", () => {
	it("`alg: none` (sin firma)", async () => {
		await expectRejected(await call(unsigned("none")));
		await expectRejected(await call(unsigned("None")));
		await expectRejected(await call(unsigned("NONE")));
	});

	it("confusion de algoritmo: HS256 firmado con la llave publica", async () => {
		const publicKeyText = JSON.parse(TEST_ENV.ACCESS_JWKS).keys[0].n;
		await expectRejected(await call(await hs256WithPublicKey(publicKeyText)));
		await expectRejected(
			await call(await hs256WithPublicKey(TEST_ENV.ACCESS_JWKS)),
		);
	});

	it("firmado con una llave del atacante pero con el `kid` legitimo", async () => {
		await expectRejected(await call(await signedByAttacker()));
	});

	it("`kid` desconocido", async () => {
		await expectRejected(await call(await signedByAttacker({}, "otra-llave")));
	});

	it("sin `kid`", async () => {
		await expectRejected(await call(await signedByAttacker({}, undefined)));
	});

	it("payload alterado conservando la firma original", async () => {
		const original = await accessJwt({ email: "admin@example.com" });
		await expectRejected(
			await call(tamperPayload(original, { email: "attacker@example.com" })),
		);
	});

	it("payload alterado para extender la expiracion", async () => {
		const expired = await accessJwt({
			exp: Math.floor(Date.now() / 1000) - 60,
		});
		await expectRejected(
			await call(
				tamperPayload(expired, { exp: Math.floor(Date.now() / 1000) + 9999 }),
			),
		);
	});

	it("firma truncada o vacia", async () => {
		const jwt = await accessJwt();
		const [h, p] = jwt.split(".");
		await expectRejected(await call(`${h}.${p}.`));
		await expectRejected(await call(`${h}.${p}.AAAA`));
		await expectRejected(await call(jwt.slice(0, -10)));
	});
});

describe("basura en la cabecera", () => {
	const garbage = [
		"abc",
		"a.b",
		"a.b.c",
		"....",
		"null",
		"{}",
		"Bearer abc.def.ghi",
		"%00",
		"' OR '1'='1",
		"<script>alert(1)</script>",
		`${"A".repeat(8000)}.${"B".repeat(8000)}.${"C".repeat(8000)}`,
	];

	for (const value of garbage) {
		it(`rechaza ${JSON.stringify(value.slice(0, 40))}`, async () => {
			await expectRejected(await call(value));
		});
	}
});

describe("Access mal configurado: falla cerrado", () => {
	it("sin ACCESS_AUD -> 503, aunque el JWT sea valido", async () => {
		const res = await call(await accessJwt(), { ACCESS_AUD: "" });
		expect(res.status).toBe(503);
	});

	it("sin equipo ni JWKS -> 503", async () => {
		const res = await call(await accessJwt(), {
			ACCESS_TEAM_DOMAIN: "",
			ACCESS_JWKS: undefined,
		});
		expect(res.status).toBe(503);
	});

	it("JWKS ilegible -> 401, no 500", async () => {
		const res = await call(await accessJwt(), { ACCESS_JWKS: "no-es-json" });
		expect(res.status).toBe(401);
	});

	it("JWKS sin llaves -> 401", async () => {
		const res = await call(await accessJwt(), {
			ACCESS_JWKS: JSON.stringify({ keys: [] }),
		});
		expect(res.status).toBe(401);
	});
});
