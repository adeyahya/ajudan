CREATE TABLE `file_meta` (
	`path` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`title` text,
	`probe` text
);
