CREATE TABLE `registries` (
	`id` text(6) PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`registry_url` text NOT NULL,
	`username` text,
	`password` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
