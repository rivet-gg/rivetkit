import { actor, setup } from "@rivetkit/actor";
import { db } from "@rivetkit/db";

export const chat = actor({
	onAuth: () => {},
	db: db({
		onMigrate: async (c) => {
			await c
				.prepare(`CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				sender TEXT NOT NULL,
				text TEXT NOT NULL,
				timestamp INTEGER NOT NULL
			)`)
				.run();
		},
	}),
	actions: {
		// Callable functions from clients: https://rivet.gg/docs/actors/actions
		sendMessage: async (c, sender: string, text: string) => {
			const message = { sender, text, timestamp: Date.now() };
			// State changes are automatically persisted
			await c.db
				.prepare(
					`INSERT INTO messages (sender, text, timestamp) VALUES (?, ?, ?)`,
					[sender, text, message.timestamp],
				)
				.run();
			// Send events to all connected clients: https://rivet.gg/docs/actors/events
			c.broadcast("newMessage", message);
			return message;
		},

		getHistory: (c) =>
			c.db
				.prepare(`SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100`)
				.all(),
	},
});

export const registry = setup({
	use: { chat },
});
