ALTER TABLE `businesses` ADD `team_edits` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `created_by` text DEFAULT 'owner' NOT NULL;