import { ACCESS_AUD, ACCESS_TEAM, b64url, KEY_ID } from "./helpers.js";

/**
 * Material de atacante para las pruebas de seguridad: tokens que un
 * adversario podria fabricar sin tener la llave privada de Cloudflare.
 */

const enc = new TextEncoder();

const claims = (extra: Record<string, unknown> = {}) => ({
	email: "attacker@example.com",
	iss: ACCESS_TEAM,
	aud: [ACCESS_AUD],
	exp: Math.floor(Date.now() / 1000) + 3600,
	...extra,
});

const rsaPair = () =>
	crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);

/** Firma RS256 con una llave PROPIA del atacante, pero anunciando el `kid` legitimo. */
export const signedByAttacker = async (
	extra: Record<string, unknown> = {},
	kid: string | undefined = KEY_ID,
): Promise<string> => {
	const { privateKey } = await rsaPair();
	const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
	const payload = b64url(JSON.stringify(claims(extra)));
	const sig = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		privateKey,
		enc.encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${b64url(sig)}`;
};

/** `alg: none`: token sin firma. */
export const unsigned = (alg = "none"): string => {
	const header = b64url(JSON.stringify({ alg, typ: "JWT", kid: KEY_ID }));
	const payload = b64url(JSON.stringify(claims()));
	return `${header}.${payload}.`;
};

/**
 * Confusion de algoritmo: HS256 usando como secreto el texto de la llave
 * PUBLICA (que cualquiera puede descargar de /cdn-cgi/access/certs).
 */
export const hs256WithPublicKey = async (publicKeyText: string) => {
	const header = b64url(
		JSON.stringify({ alg: "HS256", typ: "JWT", kid: KEY_ID }),
	);
	const payload = b64url(JSON.stringify(claims()));
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(publicKeyText),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		enc.encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${b64url(sig)}`;
};

/** Cambia el payload de un JWT legitimo y conserva su firma original. */
export const tamperPayload = (
	jwt: string,
	changes: Record<string, unknown>,
): string => {
	const [h, p, s] = jwt.split(".");
	const decoded = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
	return `${h}.${b64url(JSON.stringify({ ...decoded, ...changes }))}.${s}`;
};
