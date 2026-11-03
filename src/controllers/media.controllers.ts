import type { Db } from "../lib/db.js";
import { normalizeKey } from "../lib/media.js";
import { about } from "../schemas/about.js";
import { education } from "../schemas/education.js";
import { experience } from "../schemas/experiences.js";
import { projects } from "../schemas/projects.js";
import { siteCopy } from "../schemas/siteCopy.js";

/** Donde se usa una imagen: para mostrarlo en la biblioteca y bloquear borrados. */
export interface MediaUsage {
	resource: "projects" | "experiences" | "education" | "about" | "site-copy";
	id: number;
	label: string;
	field: string;
}

const parseList = (raw: unknown): string[] => {
	if (typeof raw !== "string" || raw === "") return [];
	try {
		const value = JSON.parse(raw);
		return Array.isArray(value)
			? value.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
};

/**
 * Recorre las columnas de imagen de TODAS las tablas y devuelve, por clave
 * normalizada, donde se usa. Son cientos de filas como mucho: no hace falta un
 * registro aparte que se desincronice (docs/plan/02: "media_assets descartada").
 */
export async function GetMediaUsage(
	db: Db,
): Promise<Map<string, MediaUsage[]>> {
	const [projectRows, experienceRows, educationRows, aboutRows, siteRows] =
		await Promise.all([
			db
				.select({
					id: projects.project_id,
					label: projects.title_default,
					card: projects.card_image,
					gallery: projects.gallery,
				})
				.from(projects),
			db
				.select({
					id: experience.experience_id,
					label: experience.title_default,
					img: experience.img,
				})
				.from(experience),
			db
				.select({
					id: education.education_id,
					label: education.institution_default,
					image: education.image,
				})
				.from(education),
			db.select({ id: about.about_id, image: about.image }).from(about),
			db
				.select({ id: siteCopy.site_copy_id, hero: siteCopy.hero_image })
				.from(siteCopy),
		]);

	const usage = new Map<string, MediaUsage[]>();
	const add = (key: string | null | undefined, use: MediaUsage) => {
		if (!key) return;
		const normalized = normalizeKey(key);
		usage.set(normalized, [...(usage.get(normalized) ?? []), use]);
	};

	for (const r of projectRows) {
		add(r.card, {
			resource: "projects",
			id: r.id,
			label: r.label,
			field: "card_image",
		});
		for (const key of parseList(r.gallery)) {
			add(key, {
				resource: "projects",
				id: r.id,
				label: r.label,
				field: "gallery",
			});
		}
	}
	for (const r of experienceRows) {
		add(r.img, {
			resource: "experiences",
			id: r.id,
			label: r.label,
			field: "img",
		});
	}
	for (const r of educationRows) {
		add(r.image, {
			resource: "education",
			id: r.id,
			label: r.label,
			field: "image",
		});
	}
	for (const r of aboutRows) {
		add(r.image, {
			resource: "about",
			id: r.id,
			label: "Sobre mí",
			field: "image",
		});
	}
	for (const r of siteRows) {
		add(r.hero, {
			resource: "site-copy",
			id: r.id,
			label: "Textos del sitio",
			field: "hero_image",
		});
	}
	return usage;
}

export interface MediaObject {
	key: string;
	size: number;
	uploaded: string;
	usedBy: MediaUsage[];
}

const MAX_PAGES = 5;

/** Objetos del bucket (hasta 5 000) con su uso. `truncated` avisa si hay mas. */
export async function ListMedia(
	bucket: R2Bucket,
	db: Db,
): Promise<{ objects: MediaObject[]; truncated: boolean }> {
	const usage = await GetMediaUsage(db);
	const objects: MediaObject[] = [];
	let cursor: string | undefined;
	let truncated = false;

	for (let page = 0; page < MAX_PAGES; page++) {
		const listing = await bucket.list({ limit: 1000, cursor });
		for (const object of listing.objects) {
			objects.push({
				key: object.key,
				size: object.size,
				uploaded: object.uploaded.toISOString(),
				usedBy: usage.get(normalizeKey(object.key)) ?? [],
			});
		}
		if (!listing.truncated) break;
		cursor = listing.cursor;
		truncated = page === MAX_PAGES - 1;
	}

	objects.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
	return { objects, truncated };
}
