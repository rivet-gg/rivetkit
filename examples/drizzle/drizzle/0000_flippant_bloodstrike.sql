CREATE TABLE `messages_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sender` text NOT NULL,
	`text` text NOT NULL,
	`timestamp` integer NOT NULL
);
