CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`created_by` text DEFAULT 'owner' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_unique_idx` ON `links` (`business_id`,`from_type`,`from_id`,`to_type`,`to_id`);--> statement-breakpoint
CREATE INDEX `links_to_idx` ON `links` (`business_id`,`to_type`,`to_id`);--> statement-breakpoint
CREATE TABLE `object_history` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`action` text NOT NULL,
	`by` text DEFAULT 'owner' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `object_history_object_idx` ON `object_history` (`business_id`,`object_type`,`object_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `object_history_business_idx` ON `object_history` (`business_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `assets` ADD `created_by` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `updated_by` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `assets_business_deleted_idx` ON `assets` (`business_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `businesses` ADD `agent_access` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `updated_by` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `follow_up_at` integer;--> statement-breakpoint
ALTER TABLE `contacts` ADD `follow_up_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `contacts_business_deleted_idx` ON `contacts` (`business_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `contacts_business_follow_up_idx` ON `contacts` (`business_id`,`follow_up_at`);--> statement-breakpoint
ALTER TABLE `context_pages` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `context_pages_business_deleted_idx` ON `context_pages` (`business_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `deliverables` ADD `folder` text;--> statement-breakpoint
ALTER TABLE `deliverables` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `deliverables` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `deliverables` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `deliverables_business_deleted_idx` ON `deliverables` (`business_id`,`deleted_at`);--> statement-breakpoint
UPDATE `deliverables` SET `created_by` = CASE WHEN `teammate_id` IS NOT NULL THEN 'teammate:' || `teammate_id` ELSE 'owner' END WHERE `created_by` IS NULL;
--> statement-breakpoint
-- Library search (src/lib/search.ts), like drizzle/0020_search.sql: a trigram FTS5 table
-- kept in step with `assets` by triggers, keyed by the row's `path` (stored as `id`).
-- Files without an assets row aren't indexed (they have no title, note or tags yet).
-- A phrase match on a path also finds longer paths containing it, so deletes check `id` too.
CREATE VIRTUAL TABLE `assets_fts` USING fts5(id, business_id UNINDEXED, title, note, tags, album, path, tokenize = 'trigram');
--> statement-breakpoint
INSERT INTO `assets_fts` (id, business_id, title, note, tags, album, path) SELECT path, business_id, title, note, tags, album, path FROM `assets`;
--> statement-breakpoint
CREATE TRIGGER `assets_fts_ai` AFTER INSERT ON `assets` BEGIN INSERT INTO `assets_fts` (id, business_id, title, note, tags, album, path) VALUES (new.path, new.business_id, new.title, new.note, new.tags, new.album, new.path); END;
--> statement-breakpoint
CREATE TRIGGER `assets_fts_ad` AFTER DELETE ON `assets` BEGIN DELETE FROM `assets_fts` WHERE rowid IN (SELECT rowid FROM assets_fts WHERE assets_fts MATCH ('id:"' || replace(old.path, '"', '""') || '"') AND id = old.path); END;
--> statement-breakpoint
CREATE TRIGGER `assets_fts_au` AFTER UPDATE OF path, title, note, tags, album ON `assets` BEGIN DELETE FROM `assets_fts` WHERE rowid IN (SELECT rowid FROM assets_fts WHERE assets_fts MATCH ('id:"' || replace(old.path, '"', '""') || '"') AND id = old.path); INSERT INTO `assets_fts` (id, business_id, title, note, tags, album, path) VALUES (new.path, new.business_id, new.title, new.note, new.tags, new.album, new.path); END;
