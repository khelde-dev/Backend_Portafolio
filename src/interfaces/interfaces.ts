export * from "../lib/constants.js";

export interface Lang {
	currentLocale: string;
}

// Fuente unica de tipos compartidos: cada schema define sus tipos (junto
// a su tabla/schema de Zod, que si necesitan vivir ahi por las reglas de
// Drizzle/drizzle-zod), pero todo lo que otro archivo importa como TIPO
// pasa por aqui - un solo lugar para ver que tipos existen en la API, en
// vez de tener que saber en que archivo de schema vive cada uno.
export type { AboutAdminInput } from "../schemas/about.js";
export type {
	InsertComment,
	SelectComment,
	UpdateCommentStatusInput,
	UserInputComment,
} from "../schemas/comments.js";
export type { ContactInfoInput } from "../schemas/contactInfo.js";

export type {
	ContactMessageUserInput,
	InsertContactMessage,
	SelectContactMessage,
	UpdateContactMessageStatusInput,
} from "../schemas/contactMessages.js";
export type { EducationAdminInput } from "../schemas/education.js";
export type { ExperienceAdminInput } from "../schemas/experiences.js";
export type { ProjectAdminInput } from "../schemas/projects.js";
export type { SkillAdminInput } from "../schemas/skills.js";

// Enums útiles
export enum CommentDirection {
	LEFT = "left",
	BOTTOM = "bottom",
}

// Tipo para la respuesta de la API
export interface ApiResponse<T> {
	success: boolean;
	data?: T;
	message?: string;
	errors?: unknown[];
}
