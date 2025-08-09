import { actor } from "@rivetkit/core";

export const counter = actor({
	onAuth: () => {},
	state: { count: 0 },
	onConnect: (c, conn) => {
		c.broadcast("onconnect:broadcast", "Hello!");
		conn.send("onconnect:msg", "Welcome to the counter actor!");
	},
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
		getCount: (c) => {
			return c.state.count;
		},
	},
});
