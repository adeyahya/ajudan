CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`hosts` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `businesses` ADD `network_domains` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `teammates` ADD `shell_access` integer DEFAULT false NOT NULL;