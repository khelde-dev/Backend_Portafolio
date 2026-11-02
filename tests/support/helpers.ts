import type { Bindings } from "../../src/env.js";
import realApp from "../../src/index.js";

/**
 * Utilidades compartidas por los archivos de test. La app ahora recibe sus
 * secretos y bindings por peticion (`c.env`), asi que las pruebas le pasan un
 * entorno de mentira en lugar de leer .env: nada toca Cloudflare ni una base real.
 */

export const TOKEN = "test-api-token";
export const ACCESS_AUD = "test-access-aud";
export const ACCESS_TEAM = "https://test-team.cloudflareaccess.com";
export const KEY_ID = "test-key-1";

// Par de llaves RSA de usar y tirar: Cloudflare Access firma con RS256 y el
// Worker verifica contra las llaves publicas (aqui entregadas por ACCESS_JWKS).
const pair = await crypto.subtle.generateKey(
	{
		name: "RSASSA-PKCS1-v1_5",
		modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1]),
		hash: "SHA-256",
	},
	true,
	["sign", "verify"],
);
export const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

export const b64url = (input: string | ArrayBuffer): string => {
	const bytes =
		typeof input === "string"
			? new TextEncoder().encode(input)
			: new Uint8Array(input);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
};

/** JWT como el que Access agrega en la cabecera Cf-Access-Jwt-Assertion. */
export const accessJwt = async (
	claims: Record<string, unknown> = {},
	key: CryptoKey = pair.privateKey,
): Promise<string> => {
	const header = b64url(
		JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID }),
	);
	const payload = b64url(
		JSON.stringify({
			email: "admin@example.com",
			iss: ACCESS_TEAM,
			aud: [ACCESS_AUD],
			exp: Math.floor(Date.now() / 1000) + 3600,
			...claims,
		}),
	);
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${b64url(signature)}`;
};

export const TEST_ENV = {
	DB: {} as D1Database, // las pruebas reemplazan createDb (ver setup.ts)
	MEDIA: {} as R2Bucket,
	API_TOKEN: TOKEN,
	ACCESS_TEAM_DOMAIN: ACCESS_TEAM,
	ACCESS_AUD,
	ACCESS_JWKS: JSON.stringify({
		keys: [{ ...publicJwk, kid: KEY_ID, alg: "RS256", use: "sig" }],
	}),
	ALLOWED_ORIGINS: "http://localhost:4321",
} satisfies Bindings;

// biome-ignore lint/suspicious/noExplicitAny: el cuerpo JSON de las respuestas se inspecciona libremente en los tests
type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };

/** La app con su entorno de prueba ya puesto. */
export const app = {
	request: (
		input: string,
		init?: RequestInit,
		env: Partial<Bindings> = {},
	): Promise<TestResponse> =>
		Promise.resolve(
			realApp.request(input, init, { ...TEST_ENV, ...env }),
		) as Promise<TestResponse>,
};

// Content-Type: application/json por default en TODAS las requests, no solo
// las que llevan body: hono/csrf trata una request sin Content-Type como
// "text/plain" y, sin Origin, la bloquea con 403 (un DELETE sin body caia ahi).
export const authed = (init: RequestInit = {}): RequestInit => ({
	...init,
	headers: {
		Authorization: `Bearer ${TOKEN}`,
		"Content-Type": "application/json",
		...init.headers,
	},
});

/** authed() + sesion de Cloudflare Access valida, para las rutas del CMS. */
export const adminAuthed = async (
	init: RequestInit = {},
	claims: Record<string, unknown> = {},
): Promise<RequestInit> => ({
	...authed(init),
	headers: {
		...(authed(init).headers as Record<string, string>),
		"Cf-Access-Jwt-Assertion": await accessJwt(claims),
	},
});

// Cada test que ejercita el rate limiter usa su propia IP simulada, para no
// compartir estado con otros tests que pegan al mismo endpoint.
let nextIp = 1;
export const uniqueIp = (): string => `203.0.113.${nextIp++}`;
