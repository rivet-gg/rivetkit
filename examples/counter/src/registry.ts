import { actor, setup } from "@rivetkit/actor";

const counter = actor({
	state: {
		count: 0,
	},
	onAuth: () => {
		return true;
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

export const registry = setup({
	use: { counter },
});

export type Registry = typeof registry;
