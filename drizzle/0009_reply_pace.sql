ALTER TABLE `tasks` ADD `urgent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wa_watches` ADD `last_sent_at` integer;--> statement-breakpoint
ALTER TABLE `wa_watches` ADD `pace` text DEFAULT 'normal' NOT NULL;