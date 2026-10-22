ALTER TABLE `deliverables` ADD `versions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `deliverable_id` text;