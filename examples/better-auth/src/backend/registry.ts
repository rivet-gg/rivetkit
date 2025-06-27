import { actor, OnAuthOptions, setup, UserError } from "@rivetkit/actor";
import { auth } from "./auth";

interface State {
	messages: Message[];
}

interface Message {
	id: string;
	userId: string;
	username: string;
	message: string;
	timestamp: number;
}

export const chatRoom = actor({
	onAuth: async (c: OnAuthOptions) => {
		const authResult = await auth.api.getSession({
			headers: c.req.headers,
		});
		console.log("auth result", authResult);

		if (!authResult?.session || !authResult?.user) {
			throw new UserError("Unauthorized");
		}

		return {
			user: authResult.user,
			session: authResult.session,
		};
	},
	state: {
		messages: [],
	} as State,
	actions: {
		sendMessage: (c, message: string) => {
			const newMessage = {
				id: crypto.randomUUID(),
				userId: "TODO",
				username: c.conn.auth.user.email || "Unknown",
				message,
				timestamp: Date.now(),
			};

			c.state.messages.push(newMessage);
			c.broadcast("newMessage", newMessage);

			return newMessage;
		},
		getMessages: (c) => {
			return c.state.messages;
		},
	},
});

export const registry = setup({
	use: { chatRoom },
});
