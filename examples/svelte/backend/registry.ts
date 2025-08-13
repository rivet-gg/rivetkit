import { actor, setup } from "@rivetkit/actor";

export const counter = actor({
	onAuth: () => {
		// Configure auth here
	},
	state: { count: 0 },
	actions: {
		increment: (c, x: number) => {
			console.log("incrementing by", x);
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
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
	use: { counter },
});
