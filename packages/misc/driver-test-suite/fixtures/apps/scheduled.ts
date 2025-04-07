import { actor, setup } from "actor-core";

const scheduled = actor({
	state: {
		lastRun: 0,
		scheduledCount: 0,
	},
	actions: {
		scheduleTask: (c, delayMs: number) => {
			const timestamp = Date.now() + delayMs;
			c.schedule.at(timestamp, "onScheduledTask");
			return timestamp;
		},
		getLastRun: (c) => {
			return c.state.lastRun;
		},
		getScheduledCount: (c) => {
			return c.state.scheduledCount;
		},
		onScheduledTask: (c) => {
			c.state.lastRun = Date.now();
			c.state.scheduledCount++;
			c.broadcast("scheduled", {
				time: c.state.lastRun,
				count: c.state.scheduledCount,
			});
		},
	},
});

export const app = setup({
	actors: { scheduled },
});

export type App = typeof app;
