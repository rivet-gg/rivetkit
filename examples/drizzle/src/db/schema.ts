import { int, sqliteTable, text } from "@rivetkit/db/drizzle";

export const messagesTable = sqliteTable("messages_table", {
	id: int().primaryKey({ autoIncrement: true }),
	sender: text().notNull(),
	text: text().notNull(),
	timestamp: int().notNull(),
});
