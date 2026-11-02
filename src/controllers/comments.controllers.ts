import { count, eq, sql } from "drizzle-orm";
import type {
	CommentStatus,
	InsertComment,
	SelectComment,
} from "../interfaces/interfaces.js";
import type { Db } from "../lib/db.js";
import { comments } from "../schemas/comments.js";

const PUBLIC_COLUMNS = {
	comment_id: comments.comment_id,
	name: comments.name,
	job: comments.job,
	description: comments.description,
	direction: comments.direction,
	country_flag: comments.country_flag,
	country: comments.country,
	created_at: comments.created_at,
	updated_at: comments.updated_at,
	status: comments.status,
} as const;

// Una fecha danada en la base no debe tumbar la lista completa (500).
const toDateOnly = <T extends { created_at: string }>(comment: T) => {
	const date = new Date(comment.created_at);
	return {
		...comment,
		created_at: Number.isNaN(date.getTime())
			? String(comment.created_at).slice(0, 10)
			: date.toISOString().slice(0, 10),
	};
};

// Lectura publica: SOLO comentarios ya aprobados. Un comentario nuevo del
// publico nace "pending" (ver PostComments abajo) y no aparece aqui hasta
// que el admin lo apruebe - ver docs/02-comentarios-y-contacto.md.
export async function GetAllComments(db: Db): Promise<SelectComment[]> {
	const allComments = await db
		.select(PUBLIC_COLUMNS)
		.from(comments)
		.where(eq(comments.status, "published"))
		.orderBy(sql`${comments.created_at} asc`)
		.all();

	return allComments.map(toDateOnly);
}

// Lectura para el admin: todos los estados, incluye "pending"/"hidden".
// Protegida por adminAuth (JWT) en comments.routes.ts - ver
// docs/03-hono-admin-auth.md.
export async function GetAllCommentsAdmin(db: Db): Promise<SelectComment[]> {
	const allComments = await db
		.select(PUBLIC_COLUMNS)
		.from(comments)
		.orderBy(sql`${comments.created_at} asc`)
		.all();

	return allComments.map(toDateOnly);
}

// Aprobar/ocultar un comentario - la unica forma real de que un
// comentario "pending" llegue a verse en el sitio publico.
export async function UpdateCommentStatus(
	db: Db,
	commentId: number,
	status: CommentStatus,
): Promise<SelectComment | null> {
	const result = await db
		.update(comments)
		.set({ status, updated_at: sql`current_timestamp` })
		.where(eq(comments.comment_id, commentId))
		.returning();

	return result[0] ? toDateOnly(result[0]) : null;
}

export async function PostComments(
	db: Db,
	{
		name,
		job,
		description,
		country_flag,
		country,
	}: Omit<InsertComment, "direction" | "status">,
): Promise<SelectComment> {
	// Contar los comentarios actuales para alternar la dirección - count()
	// agregado en vez de traer la tabla completa (SELECT *) solo para medir
	// su longitud. La version vieja se agravaba justo bajo flood (ver
	// docs/00-auditoria.md hallazgo 5).
	const [{ value: total }] = await db.select({ value: count() }).from(comments);
	const direction = total % 2 === 0 ? "left" : "bottom";

	// Insertar el nuevo comentario - SIEMPRE "pending", nunca se publica en
	// vivo solo con este POST (docs/02-comentarios-y-contacto.md). Es el
	// vector real del hackeo de 800 comentarios (docs/00-auditoria.md
	// hallazgo 1) - el rate limit ya frena el volumen, esto frena que
	// cualquier volumen que pase el rate limit aparezca publicado sin que
	// el admin lo vea primero.
	const result = await db
		.insert(comments)
		.values({
			name,
			job: job ?? null,
			description,
			direction,
			country_flag,
			country: country ?? null,
			status: "pending",
		})
		.returning();

	return result[0];
}
