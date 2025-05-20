import { actor, setup } from "actor-core";

const counterWithParams = actor({
	state: { count: 0, initializers: [] as string[] },
	createConnState: (c, { params }: { params: { name?: string } }) => {
		return {
			name: params?.name || "anonymous",
		};
	},
	onConnect: (c, conn) => {
		// Record connection name
		c.state.initializers.push(conn.state.name);
	},
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", {
				count: c.state.count,
				by: c.conn.state.name,
			});
			return c.state.count;
		},
		getInitializers: (c) => {
			return c.state.initializers;
		},
	},
});

export const app = setup({
	actors: { counter: counterWithParams },
});

export type App = typeof app;
