CREATE TABLE `activity_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` text NOT NULL,
	`teammate_id` text,
	`task_id` text,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`teammate_id` text NOT NULL,
	`task_id` text,
	`tool_name` text NOT NULL,
	`input` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teammate_id`) REFERENCES `teammates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`language` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'onboarding' NOT NULL,
	`profile` text,
	`onboarding_session_id` text,
	`busy` integer DEFAULT false NOT NULL,
	`team_summary` text,
	`browser_sites` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deliverables` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`teammate_id` text,
	`task_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`channel` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teammate_id`) REFERENCES `teammates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `onboarding_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`teammate_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`result` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teammate_id`) REFERENCES `teammates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `teammates` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`role_key` text NOT NULL,
	`title` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`persona` text DEFAULT '' NOT NULL,
	`why` text,
	`responsibilities` text DEFAULT '[]' NOT NULL,
	`kpis` text DEFAULT '[]' NOT NULL,
	`autonomy` text DEFAULT 'ask' NOT NULL,
	`schedule` text,
	`schedule_prompt` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`current_activity` text,
	`session_id` text,
	`workspace_dir` text,
	`desk_index` integer DEFAULT 0 NOT NULL,
	`browser_access` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
