CREATE INDEX `activity_events_business_id_idx` ON `activity_events` (`business_id`,`id`);--> statement-breakpoint
CREATE INDEX `approvals_business_status_idx` ON `approvals` (`business_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_teammate_status_idx` ON `tasks` (`teammate_id`,`status`);