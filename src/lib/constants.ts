export const CATEGORIES = [
	"frontend",
	"backend",
	"companies",
	"dataAnalyst",
] as const;

export const LOCALES = ["en", "es", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export const PROJECT_STATUSES = ["draft", "published"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Cola de moderacion de comentarios: "pending" es como nace todo comentario
// publico, "published" es lo aprobado, "hidden" una moderacion manual.
export const COMMENT_STATUSES = ["pending", "published", "hidden"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const CONTACT_MESSAGE_STATUSES = ["unread", "read", "replied"] as const;
export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];
