ALTER TABLE `businesses` ADD `whatsapp_chats` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `teammates` ADD `whatsapp_access` integer DEFAULT false NOT NULL;