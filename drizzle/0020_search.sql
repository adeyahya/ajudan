-- Full-text search (src/lib/search.ts): trigram FTS5 tables kept in step with
-- context_pages, contacts and deliverables by triggers. Rows are keyed by the content
-- row's `id` (matched as a phrase), never its rowid, which VACUUM may renumber.
-- drizzle-kit can't model virtual tables: a migration that rebuilds one of these
-- content tables must recreate its triggers.
CREATE VIRTUAL TABLE `context_pages_fts` USING fts5(id, business_id UNINDEXED, title, body, tokenize = 'trigram');
--> statement-breakpoint
INSERT INTO `context_pages_fts` (id, business_id, title, body) SELECT id, business_id, title, body FROM `context_pages`;
--> statement-breakpoint
CREATE TRIGGER `context_pages_fts_ai` AFTER INSERT ON `context_pages` BEGIN INSERT INTO `context_pages_fts` (id, business_id, title, body) VALUES (new.id, new.business_id, new.title, new.body); END;
--> statement-breakpoint
CREATE TRIGGER `context_pages_fts_ad` AFTER DELETE ON `context_pages` BEGIN DELETE FROM `context_pages_fts` WHERE rowid IN (SELECT rowid FROM context_pages_fts WHERE context_pages_fts MATCH ('id:"' || old.id || '"')); END;
--> statement-breakpoint
CREATE TRIGGER `context_pages_fts_au` AFTER UPDATE OF title, body ON `context_pages` BEGIN DELETE FROM `context_pages_fts` WHERE rowid IN (SELECT rowid FROM context_pages_fts WHERE context_pages_fts MATCH ('id:"' || old.id || '"')); INSERT INTO `context_pages_fts` (id, business_id, title, body) VALUES (new.id, new.business_id, new.title, new.body); END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `contacts_fts` USING fts5(id, business_id UNINDEXED, name, company, phone, email, tags, notes, tokenize = 'trigram');
--> statement-breakpoint
INSERT INTO `contacts_fts` (id, business_id, name, company, phone, email, tags, notes) SELECT id, business_id, name, company, phone, email, tags, notes FROM `contacts`;
--> statement-breakpoint
CREATE TRIGGER `contacts_fts_ai` AFTER INSERT ON `contacts` BEGIN INSERT INTO `contacts_fts` (id, business_id, name, company, phone, email, tags, notes) VALUES (new.id, new.business_id, new.name, new.company, new.phone, new.email, new.tags, new.notes); END;
--> statement-breakpoint
CREATE TRIGGER `contacts_fts_ad` AFTER DELETE ON `contacts` BEGIN DELETE FROM `contacts_fts` WHERE rowid IN (SELECT rowid FROM contacts_fts WHERE contacts_fts MATCH ('id:"' || old.id || '"')); END;
--> statement-breakpoint
CREATE TRIGGER `contacts_fts_au` AFTER UPDATE OF name, company, phone, email, tags, notes ON `contacts` BEGIN DELETE FROM `contacts_fts` WHERE rowid IN (SELECT rowid FROM contacts_fts WHERE contacts_fts MATCH ('id:"' || old.id || '"')); INSERT INTO `contacts_fts` (id, business_id, name, company, phone, email, tags, notes) VALUES (new.id, new.business_id, new.name, new.company, new.phone, new.email, new.tags, new.notes); END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `deliverables_fts` USING fts5(id, business_id UNINDEXED, title, content, tokenize = 'trigram');
--> statement-breakpoint
INSERT INTO `deliverables_fts` (id, business_id, title, content) SELECT id, business_id, title, content FROM `deliverables`;
--> statement-breakpoint
CREATE TRIGGER `deliverables_fts_ai` AFTER INSERT ON `deliverables` BEGIN INSERT INTO `deliverables_fts` (id, business_id, title, content) VALUES (new.id, new.business_id, new.title, new.content); END;
--> statement-breakpoint
CREATE TRIGGER `deliverables_fts_ad` AFTER DELETE ON `deliverables` BEGIN DELETE FROM `deliverables_fts` WHERE rowid IN (SELECT rowid FROM deliverables_fts WHERE deliverables_fts MATCH ('id:"' || old.id || '"')); END;
--> statement-breakpoint
CREATE TRIGGER `deliverables_fts_au` AFTER UPDATE OF title, content ON `deliverables` BEGIN DELETE FROM `deliverables_fts` WHERE rowid IN (SELECT rowid FROM deliverables_fts WHERE deliverables_fts MATCH ('id:"' || old.id || '"')); INSERT INTO `deliverables_fts` (id, business_id, title, content) VALUES (new.id, new.business_id, new.title, new.content); END;
