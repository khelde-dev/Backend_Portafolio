CREATE TABLE `contact_info` (
	`id` integer PRIMARY KEY NOT NULL,
	`github_url` text NOT NULL,
	`linkedin_url` text NOT NULL,
	`linkedin_name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);

--> statement-breakpoint
-- Semilla: los datos que el sitio tenia escritos en el codigo. Se cambian desde el
-- CMS; OR IGNORE no pisa nada si la fila ya existe.
INSERT OR IGNORE INTO `contact_info` (`id`, `github_url`, `linkedin_url`, `linkedin_name`, `phone`, `email`)
VALUES (
	1,
	'https://github.com/muke78',
	'https://www.linkedin.com/in/erick-miguel-gonz%C3%A1lez-rivera-96265b248/',
	'Erick Miguel Gonzalez Rivera',
	'+52 55 1190 9105',
	'erickm.gonzalez.rivera@gmail.com'
);
