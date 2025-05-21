import { actor, setup } from "actor-core";

// Short timeout actor
const shortTimeoutActor = actor({
	state: { value: 0 },
	options: {
		action: {
			timeout: 50, // 50ms timeout
		},
	},
	actions: {
		quickAction: async (c) => {
			return "quick response";
		},
		slowAction: async (c) => {
			// This action should timeout
			await new Promise((resolve) => setTimeout(resolve, 100));
			return "slow response";
		},
	},
});

// Long timeout actor
const longTimeoutActor = actor({
	state: { value: 0 },
	options: {
		action: {
			timeout: 200, // 200ms timeout
		},
	},
	actions: {
		delayedAction: async (c) => {
			// This action should complete within timeout
			await new Promise((resolve) => setTimeout(resolve, 100));
			return "delayed response";
		},
	},
});

// Default timeout actor
const defaultTimeoutActor = actor({
	state: { value: 0 },
	actions: {
		normalAction: async (c) => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			return "normal response";
		},
	},
});

// Sync actor (timeout shouldn't apply)
const syncActor = actor({
	state: { value: 0 },
	options: {
		action: {
			timeout: 50, // 50ms timeout
		},
	},
	actions: {
		syncAction: (c) => {
			return "sync response";
		},
	},
});

export const app = setup({
	actors: {
		shortTimeoutActor,
		longTimeoutActor,
		defaultTimeoutActor,
		syncActor,
	},
});

export type App = typeof app;

