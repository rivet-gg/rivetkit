import { worker, setup } from "@rivetkit/worker";

export const counter = worker({
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
	workers: { counter },
});

export type Registry = typeof registry;
