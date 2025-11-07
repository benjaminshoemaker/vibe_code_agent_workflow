CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`stage` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_session_idx` ON `chat_messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `chat_session_stage_idx` ON `chat_messages` (`session_id`,`stage`);--> statement-breakpoint
CREATE TABLE `designs` (
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`sha256` text NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`session_id`, `path`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `designs_sha_idx` ON `designs` (`sha256`);--> statement-breakpoint
CREATE TABLE `docs` (
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `docs_session_name_idx` ON `docs` (`session_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`current_stage` text NOT NULL,
	`approved_intake` integer DEFAULT false NOT NULL,
	`approved_one_pager` integer DEFAULT false NOT NULL,
	`approved_spec` integer DEFAULT false NOT NULL,
	`approved_design` integer DEFAULT false NOT NULL,
	`approved_prompt_plan` integer DEFAULT false NOT NULL,
	`approved_agents` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`last_activity` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_stage_idx` ON `sessions` (`current_stage`);--> statement-breakpoint
CREATE INDEX `sessions_activity_idx` ON `sessions` (`last_activity`);