CREATE TABLE `human_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`human_id` text NOT NULL,
	`direction` text NOT NULL,
	`from_teammate_id` text,
	`task_id` text,
	`text` text DEFAULT '' NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`wa_message_id` text,
	`sent_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`human_id`) REFERENCES `teammates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `human_messages_wa_message_id_unique` ON `human_messages` (`wa_message_id`);--> statement-breakpoint
ALTER TABLE `teammates` ADD `kind` text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE `teammates` ADD `phone` text;