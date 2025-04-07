import { actor, setup } from "actor-core";

const counter = actor({
	state: { count: 0 },
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
	},
});

export const app = setup({
	actors: { counter },
});

export type App = typeof app;
