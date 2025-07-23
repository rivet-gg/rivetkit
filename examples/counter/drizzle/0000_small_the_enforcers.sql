CREATE TABLE `all_types_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text,
	`text_json` text,
	`text_enum` text,
	`blob` blob,
	`blob_buffer` blob,
	`blob_bigint` blob,
	`blob_json` blob,
	`numeric` numeric,
	`numeric_number` numeric,
	`numeric_bigint` numeric,
	`real` real,
	`int` integer,
	`int_number` integer,
	`int_boolean` integer,
	`int_timestamp_ms` integer,
	`int_timestamp` integer,
	`default_time` text DEFAULT (CURRENT_TIME),
	`default_date` text DEFAULT (CURRENT_DATE),
	`default_timestamp` text DEFAULT (CURRENT_TIMESTAMP),
	`default_int` integer DEFAULT 42,
	`default_int_sql` integer DEFAULT (abs(42)),
	`default_fn` integer,
	`notnull_int` integer NOT NULL,
	`always_null` text
);
--> statement-breakpoint
CREATE TABLE `posts_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`userId` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users_table`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`age` integer NOT NULL,
	`email` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_table_email_unique` ON `users_table` (`email`);