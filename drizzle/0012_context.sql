CREATE TABLE `context_asks` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`teammate_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`cited` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teammate_id`) REFERENCES `teammates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `context_loads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` text NOT NULL,
	`task_id` text NOT NULL,
	`teammate_id` text NOT NULL,
	`page_id` text,
	`label` text NOT NULL,
	`mode` text NOT NULL,
	`chars` integer DEFAULT 0 NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `context_pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `context_loads_task_idx` ON `context_loads` (`task_id`);--> statement-breakpoint
CREATE INDEX `context_loads_page_idx` ON `context_loads` (`page_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `context_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`parent_id` text,
	`section` text DEFAULT 'business' NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'page' NOT NULL,
	`source` text,
	`key` text,
	`body` text DEFAULT '' NOT NULL,
	`blocks` text,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_by` text DEFAULT 'owner' NOT NULL,
	`updated_by` text DEFAULT 'owner' NOT NULL,
	`last_checked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `context_pages_business_idx` ON `context_pages` (`business_id`,`section`);--> statement-breakpoint
CREATE TABLE `context_readers` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`teammate_id` text NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `context_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teammate_id`) REFERENCES `teammates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `context_readers_page_idx` ON `context_readers` (`page_id`,`teammate_id`);--> statement-breakpoint
CREATE TABLE `context_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`page_id` text,
	`teammate_id` text,
	`task_id` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`before` text,
	`title` text,
	`section` text,
	`reason` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `context_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teammate_id`) REFERENCES `teammates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `context_suggestions_business_idx` ON `context_suggestions` (`business_id`,`status`);