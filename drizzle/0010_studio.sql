CREATE TABLE `assets` (
	`path` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`album` text,
	`starred` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`company` text,
	`kind` text DEFAULT 'customer' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `edits` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`spec` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`output` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
