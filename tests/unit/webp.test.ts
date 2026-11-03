import { describe, expect, it } from "bun:test";
import {
	isMediaArea,
	isSafeKey,
	MEDIA_AREAS,
	newMediaKey,
	normalizeKey,
	publicUrl,
} from "../../src/lib/media.js";
import { inspectWebp } from "../../src/lib/webp.js";
import { le, TINY_WEBP, text, vp8, vp8x } from "../support/webp.js";

describe("inspectWebp", () => {
	it("lee un WebP sin perdida real", () => {
		expect(inspectWebp(TINY_WEBP)).toEqual({
			width: 1,
			height: 1,
			format: "lossless",
		});
	});

	it("lee las dimensiones de un VP8X", () => {
		expect(inspectWebp(vp8x(1280, 720))).toEqual({
			width: 1280,
			height: 720,
			format: "extended",
		});
		expect(inspectWebp(vp8x(5000, 40))?.width).toBe(5000);
	});

	it("lee las dimensiones de un VP8 con perdida", () => {
		expect(inspectWebp(vp8(640, 480))).toEqual({
			width: 640,
			height: 480,
			format: "lossy",
		});
	});

	it("rechaza un PNG, un JPEG, un SVG y texto aunque se llamen image/webp", () => {
		const png = Uint8Array.from([
			0x89,
			0x50,
			0x4e,
			0x47,
			0x0d,
			0x0a,
			0x1a,
			0x0a,
			...new Array(40).fill(0),
		]);
		const jpeg = Uint8Array.from([
			0xff,
			0xd8,
			0xff,
			0xe0,
			...new Array(40).fill(0),
		]);
		const svg = new TextEncoder().encode(
			"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>",
		);
		for (const bytes of [
			png,
			jpeg,
			svg,
			new TextEncoder().encode("hola".repeat(20)),
		]) {
			expect(inspectWebp(bytes)).toBeNull();
		}
	});

	it("rechaza RIFF que no es WebP (un WAV) y archivos demasiado cortos", () => {
		const wav = Uint8Array.from([
			...text("RIFF"),
			...le(30, 4),
			...text("WAVE"),
			...new Array(30).fill(0),
		]);
		expect(inspectWebp(wav)).toBeNull();
		expect(inspectWebp(new Uint8Array(0))).toBeNull();
		expect(inspectWebp(TINY_WEBP.subarray(0, 20))).toBeNull();
	});

	it("rechaza un archivo cortado (el tamano declarado no cabe)", () => {
		const cut = vp8x(100, 100).subarray(0, 24);
		expect(inspectWebp(cut)).toBeNull();
		const lying = vp8x(100, 100);
		lying.set(le(5000, 4), 4);
		expect(inspectWebp(lying)).toBeNull();
	});

	it("rechaza un VP8 sin el codigo de inicio y un VP8L sin firma", () => {
		const bad = vp8(10, 10);
		bad[23] = 0;
		expect(inspectWebp(bad)).toBeNull();
		const lossless = new Uint8Array(TINY_WEBP);
		lossless[20] = 0;
		expect(inspectWebp(lossless)).toBeNull();
	});

	it("un chunk desconocido no se acepta", () => {
		const odd = new Uint8Array(vp8x(10, 10));
		odd.set(text("XXXX"), 12);
		expect(inspectWebp(odd)).toBeNull();
	});
});

describe("claves de imagen", () => {
	it("la clave nueva sale del servidor: <carpeta>/<uuid>.webp", () => {
		for (const area of MEDIA_AREAS) {
			expect(newMediaKey(area)).toMatch(
				new RegExp(`^${area}/[0-9a-f-]{36}\\.webp$`),
			);
		}
		expect(newMediaKey("projects")).not.toBe(newMediaKey("projects"));
	});

	it("solo las carpetas previstas", () => {
		expect(isMediaArea("projects")).toBe(true);
		expect(isMediaArea("../etc")).toBe(false);
		expect(isMediaArea(undefined)).toBe(false);
	});

	it("normalizeKey quita la barra inicial de las claves heredadas", () => {
		expect(normalizeKey("/UPVM.webp")).toBe("UPVM.webp");
		expect(normalizeKey("//a.webp")).toBe("a.webp");
		expect(normalizeKey("projects/a.webp")).toBe("projects/a.webp");
	});

	it("publicUrl une la base sin duplicar barras y es null sin base", () => {
		expect(publicUrl("https://m.example.dev/", "/a.webp")).toBe(
			"https://m.example.dev/a.webp",
		);
		expect(publicUrl(undefined, "a.webp")).toBeNull();
	});

	it("isSafeKey rechaza lo que se sale del bucket o parece una URL", () => {
		for (const ok of ["a.webp", "projects/a.webp"])
			expect(isSafeKey(ok)).toBe(true);
		for (const bad of [
			"",
			"../a",
			"a/../b",
			"a/./b",
			"//x",
			"https://x/y",
			"a\\b",
			"a\u0000b",
			"x".repeat(513),
		]) {
			expect(isSafeKey(bad)).toBe(false);
		}
	});
});
