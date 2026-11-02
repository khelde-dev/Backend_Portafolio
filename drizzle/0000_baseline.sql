CREATE TABLE `about` (
	`id` integer PRIMARY KEY NOT NULL,
	`image` text NOT NULL,
	`title_card_default` text NOT NULL,
	`subtitle_default` text NOT NULL,
	`description_default` text NOT NULL,
	`translations` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`job` text,
	`description` text NOT NULL,
	`direction` text NOT NULL,
	`country_flag` text NOT NULL,
	`country` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contact_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`more_information` text,
	`status` text DEFAULT 'unread' NOT NULL,
	`notified_at` text,
	`replied_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `education` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`institution_default` text NOT NULL,
	`subtitle_default` text NOT NULL,
	`description_default` text NOT NULL,
	`image` text NOT NULL,
	`period_default` text NOT NULL,
	`translations` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `experience` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`work_default` text,
	`title_default` text NOT NULL,
	`subtitle_default` text NOT NULL,
	`img` text NOT NULL,
	`alt` text NOT NULL,
	`time_default` text NOT NULL,
	`location_default` text NOT NULL,
	`translations` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`card_image` text NOT NULL,
	`gallery` text DEFAULT '[]' NOT NULL,
	`video_url` text,
	`images_topics` text DEFAULT '[]' NOT NULL,
	`link_repo` text,
	`link_web` text,
	`fork` integer DEFAULT false NOT NULL,
	`title_default` text NOT NULL,
	`summary_default` text NOT NULL,
	`description_default` text NOT NULL,
	`translations` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique_idx` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title_default` text NOT NULL,
	`images_topics` text DEFAULT '[]' NOT NULL,
	`translations` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
