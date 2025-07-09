import { actor, setup } from "@rivetkit/actor";

export type Message = { sender: string; text: string; timestamp: number };

export const chatRoom = actor({
	onAuth: () => {},
	// Persistent state that survives restarts: https://rivet.gg/docs/actors/state
	state: {
		messages: [] as Message[],
	},

	actions: {
		// Callable functions from clients: https://rivet.gg/docs/actors/actions
		sendMessage: (c, sender: string, text: string) => {
			const message = { sender, text, timestamp: Date.now() };
			// State changes are automatically persisted
			c.state.messages.push(message);
			// Send events to all connected clients: https://rivet.gg/docs/actors/events
			c.broadcast("newMessage", message);
			return message;
		},

		getHistory: (c) => c.state.messages,
	},
});

// Register actors for use: https://rivet.gg/docs/setup
export const registry = setup({
	use: { chatRoom },
});
