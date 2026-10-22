CREATE TABLE `wa_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`jid` text NOT NULL,
	`name` text NOT NULL,
	`teammate_id` text NOT NULL,
	`task_id` text,
	`purpose` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`reply_by` integer NOT NULL,
	`seen_until` integer NOT NULL,
	`last_reply_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teammate_id`) REFERENCES `teammates`(`id`) ON UPDATE no action ON DELETE cascade
);
