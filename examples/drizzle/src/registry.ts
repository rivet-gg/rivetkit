import { actor, setup } from "@rivetkit/actor";
import { db } from "@rivetkit/db/drizzle";
import { desc } from "drizzle-orm";
import migrations from "../drizzle/migrations";
import * as schema from "./db/schema";

export const chat = actor({
	db: db({ schema, migrations }),
	onAuth: () => {},
	actions: {
		// Callable functions from clients: https://rivet.gg/docs/actors/actions
		sendMessage: async (c, sender: string, text: string) => {
			const message = { sender, text, timestamp: Date.now() };
			// State changes are automatically persisted
			await c.db.insert(schema.messagesTable).values(message);
			// Send events to all connected clients: https://rivet.gg/docs/actors/events
			c.broadcast("newMessage", message);
			return message;
		},

		getHistory: (c) =>
			c.db
				.select()
				.from(schema.messagesTable)
				.orderBy(desc(schema.messagesTable.timestamp))
				.limit(100),
	},
});

export const registry = setup({
	use: { chat },
});
