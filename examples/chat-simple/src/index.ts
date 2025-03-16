import { actor, setup } from "actor-core";

// state managed by the actor
export interface State {
	messages: { username: string; message: string }[];
}

export const chatRoom = actor({
	// initialize state
	createState: () => ({ messages: [] } as State),

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
export const app = setup({
	actors: { chatRoom },
});

// Export type for client type checking
export type App = typeof app;
