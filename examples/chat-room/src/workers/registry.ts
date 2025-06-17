import { worker, setup } from "rivetkit";

// state managed by the actor
export interface State {
	messages: { username: string; message: string }[];
}

export const chatRoom = worker({
	// initialize state
	state: { messages: [] } as State,

	// define actions
	actions: {
		// receive an action call from the client
		sendMessage: (c, username: string, message: string) => {
			// save message to persistent storage
			c.state.messages.push({ username, message });

			// broadcast message to all clients
			c.broadcast("newMessage", username, message);
		},

		getHistory: (c) => {
			return c.state.messages;
		},
	},
});

// Create and export the app
export const registry = setup({
	workers: { chatRoom },
});

// Export type for client type checking
export type Registry = typeof registry;
