import { worker } from "rivetkit";

// Short timeout worker
export const shortTimeoutWorker = worker({
	onAuth: () => {},
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

// Long timeout worker
export const longTimeoutWorker = worker({
	onAuth: () => {},
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

// Default timeout worker
export const defaultTimeoutWorker = worker({
	onAuth: () => {},
	state: { value: 0 },
	actions: {
		normalAction: async (c) => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			return "normal response";
		},
	},
});

// Sync worker (timeout shouldn't apply)
export const syncTimeoutWorker = worker({
	onAuth: () => {},
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


