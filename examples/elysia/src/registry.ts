import { actor, setup } from "@rivetkit/actor";

export const counter = actor({
	onAuth: () => {
		// Configure auth here
	},
	state: { count: 0 },
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			return c.state.count;
		},
	},
});

export const registry = setup({
	use: { counter },
});

export type Registry = typeof registry;
