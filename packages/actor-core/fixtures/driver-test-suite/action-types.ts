import { actor, setup, UserError } from "actor-core";

// Actor with synchronous actions
const syncActor = actor({
	state: { value: 0 },
	actions: {
		// Simple synchronous action that returns a value directly
		increment: (c, amount: number = 1) => {
			c.state.value += amount;
			return c.state.value;
		},
		// Synchronous action that returns an object
		getInfo: (c) => {
			return {
				currentValue: c.state.value,
				timestamp: Date.now(),
			};
		},
		// Synchronous action with no return value (void)
		reset: (c) => {
			c.state.value = 0;
		},
	},
});

// Actor with asynchronous actions
const asyncActor = actor({
	state: { value: 0, data: null as any },
	actions: {
		// Async action with a delay
		delayedIncrement: async (c, amount: number = 1) => {
			await Promise.resolve();
			c.state.value += amount;
			return c.state.value;
		},
		// Async action that simulates an API call
		fetchData: async (c, id: string) => {
			await Promise.resolve();

			// Simulate response data
			const data = { id, timestamp: Date.now() };
			c.state.data = data;
			return data;
		},
		// Async action with error handling
		asyncWithError: async (c, shouldError: boolean) => {
			await Promise.resolve();

			if (shouldError) {
				throw new UserError("Intentional error");
			}

			return "Success";
		},
	},
});

// Actor with promise actions
const promiseActor = actor({
	state: { results: [] as string[] },
	actions: {
		// Action that returns a resolved promise
		resolvedPromise: (c) => {
			return Promise.resolve("resolved value");
		},
		// Action that returns a promise that resolves after a delay
		delayedPromise: (c): Promise<string> => {
			return new Promise<string>((resolve) => {
				c.state.results.push("delayed");
				resolve("delayed value");
			});
		},
		// Action that returns a rejected promise
		rejectedPromise: (c) => {
			return Promise.reject(new UserError("promised rejection"));
		},
		// Action to check the collected results
		getResults: (c) => {
			return c.state.results;
		},
	},
});

export const app = setup({
	actors: {
		syncActor,
		asyncActor,
		promiseActor,
	},
});

export type App = typeof app;
