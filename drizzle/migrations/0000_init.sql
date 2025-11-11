CREATE TABLE IF NOT EXISTS `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`current_stage` text NOT NULL CHECK (`current_stage` IN ('intake','spec','design','prompt_plan','agents','export')),
	`approved_intake` integer DEFAULT 0 NOT NULL,
	`approved_spec` integer DEFAULT 0 NOT NULL,
	`approved_design` integer DEFAULT 0 NOT NULL,
	`approved_prompt_plan` integer DEFAULT 0 NOT NULL,
	`approved_agents` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`last_activity` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
CREATE INDEX IF NOT EXISTS `sessions_stage_idx` ON `sessions` (`current_stage`);
CREATE INDEX IF NOT EXISTS `sessions_activity_idx` ON `sessions` (`last_activity`);

CREATE TABLE IF NOT EXISTS `docs` (
	`session_id` text NOT NULL,
	`name` text NOT NULL CHECK (`name` IN ('idea_one_pager.md','spec.md','prompt_plan.md','AGENTS.md')),
	`content` text NOT NULL,
	`approved` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	CONSTRAINT `docs_session_id_sessions_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS `docs_session_name_idx` ON `docs` (`session_id`,`name`);

CREATE TABLE IF NOT EXISTS `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`stage` text CHECK (`stage` IN ('intake','spec','design','prompt_plan','agents','export')),
	`role` text NOT NULL CHECK (`role` IN ('user','assistant','orchestrator')),
	`content` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	CONSTRAINT `chat_messages_session_id_sessions_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `chat_session_idx` ON `chat_messages` (`session_id`);
CREATE INDEX IF NOT EXISTS `chat_session_stage_idx` ON `chat_messages` (`session_id`,`stage`);

CREATE TABLE IF NOT EXISTS `designs` (
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`sha256` text NOT NULL,
	`data` blob NOT NULL,
	CONSTRAINT `designs_session_id_sessions_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	PRIMARY KEY(`session_id`,`path`)
);
CREATE INDEX IF NOT EXISTS `designs_sha_idx` ON `designs` (`sha256`);
