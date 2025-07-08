import { actor, setup } from "@rivetkit/actor";

const chatRoom = actor({
	state: {
		messages: [] as Array<{ user: string; text: string; timestamp: number }>,
		userCount: 0,
	},
	actions: {
		sendMessage: (c, message: { user: string; text: string }) => {
			const newMessage = {
				...message,
				timestamp: Date.now(),
			};
			c.state.messages.push(newMessage);

			// Keep only last 50 messages
			if (c.state.messages.length > 50) {
				c.state.messages = c.state.messages.slice(-50);
			}

			c.broadcast("newMessage", newMessage);
			return newMessage;
		},
		getMessages: (c) => {
			return c.state.messages;
		},
		getUserCount: (c) => {
			return c.state.userCount;
		},
	},
	onConnect: (c) => {
		c.state.userCount++;
		c.broadcast("userCountUpdate", c.state.userCount);
	},
	onDisconnect: (c) => {
		c.state.userCount--;
		c.broadcast("userCountUpdate", c.state.userCount);
	},
});

const counter = actor({
	state: { count: 0 },
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
		getCount: (c) => {
			return c.state.count;
		},
		reset: (c) => {
			c.state.count = 0;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
	},
});

export const registry = setup({
	use: { chatRoom, counter },
});
