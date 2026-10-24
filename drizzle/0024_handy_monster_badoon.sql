CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`command` text,
	`args` text DEFAULT '[]' NOT NULL,
	`url` text,
	`env` text DEFAULT '{}' NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`trusted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_name_idx` ON `mcp_servers` (`business_id`,`name`);--> statement-breakpoint
ALTER TABLE `teammates` ADD `mcp_access` text DEFAULT '[]' NOT NULL;