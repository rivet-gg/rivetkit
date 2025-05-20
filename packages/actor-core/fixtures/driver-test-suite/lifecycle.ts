import { actor, setup } from "actor-core";

const lifecycleActor = actor({
	state: {
		count: 0,
		events: [] as string[],
	},
	createConnState: () => ({ joinTime: Date.now() }),
	onStart: (c) => {
		c.state.events.push("onStart");
	},
	onBeforeConnect: (c, { params }: { params: any }) => {
		c.state.events.push("onBeforeConnect");
		// Could throw here to reject connection
	},
	onConnect: (c) => {
		c.state.events.push("onConnect");
	},
	onDisconnect: (c) => {
		c.state.events.push("onDisconnect");
	},
	actions: {
		getEvents: (c) => {
			return c.state.events;
		},
		increment: (c, x: number) => {
			c.state.count += x;
			return c.state.count;
		},
	},
});

export const app = setup({
	actors: { counter: lifecycleActor },
});

export type App = typeof app;

