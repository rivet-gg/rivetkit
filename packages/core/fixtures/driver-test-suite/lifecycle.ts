import { worker } from "rivetkit";

export const counterWithLifecycle = worker({
	onAuth: () => {},
	state: {
		count: 0,
		events: [] as string[],
	},
	createConnState: (
		c,
		opts: { params: { trackLifecycle?: boolean } | undefined },
	) => ({
		joinTime: Date.now(),
	}),
	onStart: (c) => {
		c.state.events.push("onStart");
	},
	onBeforeConnect: (c, conn) => {
		if (conn.params?.trackLifecycle) c.state.events.push("onBeforeConnect");
	},
	onConnect: (c, conn) => {
		if (conn.params?.trackLifecycle) c.state.events.push("onConnect");
	},
	onDisconnect: (c, conn) => {
		if (conn.params?.trackLifecycle) c.state.events.push("onDisconnect");
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

