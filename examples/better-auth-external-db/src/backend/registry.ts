import { actor, setup, type OnAuthOptions } from "@rivetkit/actor";
import { Unauthorized } from "@rivetkit/actor/errors";
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
	// onAuth runs on the server & before connecting to the actor
	onAuth: async (c: OnAuthOptions) => {
		// ✨ NEW ✨ Access Better Auth session
		const authResult = await auth.api.getSession({
			headers: c.req.headers,
		});
		if (!authResult) throw new Unauthorized();

		// Passes auth data to the actor (c.conn.auth)
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
			// ✨ NEW ✨ — Access Better Auth with c.conn.auth
			const newMessage = {
				id: crypto.randomUUID(),
				userId: c.conn.auth.user.id,
				username: c.conn.auth.user.name,
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
