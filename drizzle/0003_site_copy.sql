CREATE TABLE `site_copy` (
	`id` integer PRIMARY KEY NOT NULL,
	`hero_image` text NOT NULL,
	`hero_image_alt_default` text NOT NULL,
	`hero_label_default` text NOT NULL,
	`hero_lead_default` text NOT NULL,
	`manifesto_text_default` text NOT NULL,
	`meta_description_default` text NOT NULL,
	`translations` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);

--> statement-breakpoint
-- Semilla: los textos que el sitio tenia en sus archivos de idioma. Se cambian desde el CMS;
-- OR IGNORE no pisa nada si la fila ya existe.
INSERT OR IGNORE INTO `site_copy` (`id`, `hero_image`, `hero_image_alt_default`, `hero_label_default`, `hero_lead_default`, `manifesto_text_default`, `meta_description_default`, `translations`)
VALUES (
	1,
	'Aboutme.webp',
	'Retrato de Erick González',
	'Desarrollador Full-Stack',
	'Ingeniero en Tecnologías de la Información titulado, especializado en desarrollo Full-Stack y análisis de datos. Con más de dos años de experiencia creando aplicaciones eficientes, escalables y bien estructuradas.',
	'Diseño y construyo productos web completos: interfaces rápidas y accesibles, APIs sólidas y datos que se convierten en decisiones.',
	'Portafolio de Erick González, desarrollador web con experiencia en frontend y backend. Mira mis proyectos y habilidades.',
	'{"en":{"hero_image_alt":"Portrait of Erick González","hero_label":"Full-stack Developer","hero_lead":"Information Technology Engineer, specialized in FullStack development and data analysis. With more than two years of experience creating efficient, scalable and well-structured applications.","manifesto_text":"I design and build complete web products: fast, accessible interfaces, solid APIs and data that turns into decisions.","meta_description":"Erick González''s portfolio, a web developer with experience in frontend and backend. Check out my projects and skills."},"fr":{"hero_image_alt":"Portrait d''Erick González","hero_label":"Développeur full-stack","hero_lead":"Ingénieur diplômé en technologies de l''information, spécialisé dans le développement FullStack et l''analyse de données. Avec plus de deux ans d''expérience dans la création d''applications efficaces, évolutives et bien structurées.","manifesto_text":"Je conçois et construis des produits web complets : interfaces rapides et accessibles, API solides et données qui deviennent des décisions.","meta_description":"Portfolio d''Erick González, développeur web avec de l''expérience en frontend et backend. Découvrez mes projets et compétences."}}'
);
