import { actor, setup, UserError } from "@/mod";
import { describe, test, expect, vi } from "vitest";
import { setupTest } from "@/test/mod";

describe("Action Types", () => {
	test("should support synchronous actions", async (c) => {
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

		const app = setup({
			actors: { syncActor },
		});

		const { client } = await setupTest<typeof app>(c, app);
		const instance = client.syncActor.getOrCreate();

		// Test increment action
		let result = await instance.increment(5);
		expect(result).toBe(5);

		result = await instance.increment(3);
		expect(result).toBe(8);

		// Test getInfo action
		const info = await instance.getInfo();
		expect(info.currentValue).toBe(8);
		expect(typeof info.timestamp).toBe("number");

		// Test reset action (void return)
		await instance.reset();
		result = await instance.increment(0);
		expect(result).toBe(0);
	});

	test("should support asynchronous actions", async (c) => {
		const asyncActor = actor({
			state: { value: 0, data: null as any },
			actions: {
				// Async action with a delay
				delayedIncrement: async (c, amount: number = 1) => {
					const delayPromise = new Promise((resolve) =>
						setTimeout(resolve, 50),
					);
					await vi.advanceTimersByTimeAsync(50);
					await delayPromise;
					c.state.value += amount;
					return c.state.value;
				},
				// Async action that simulates an API call
				fetchData: async (c, id: string) => {
					// Simulate fetch delay
					const delayPromise = new Promise((resolve) =>
						setTimeout(resolve, 50),
					);
					await vi.advanceTimersByTimeAsync(50);
					await delayPromise;

					// Simulate response data
					const data = { id, timestamp: Date.now() };
					c.state.data = data;
					return data;
				},
				// Async action with error handling
				asyncWithError: async (c, shouldError: boolean) => {
					const delayPromise = new Promise((resolve) =>
						setTimeout(resolve, 50),
					);
					await vi.advanceTimersByTimeAsync(50);
					await delayPromise;

					if (shouldError) {
						throw new UserError("Intentional error");
					}

					return "Success";
				},
			},
		});

		const app = setup({
			actors: { asyncActor },
		});

		const { client } = await setupTest<typeof app>(c, app);
		const instance = client.asyncActor.getOrCreate();

		// Test delayed increment
		const result = await instance.delayedIncrement(5);
		expect(result).toBe(5);

		// Test fetch data
		const data = await instance.fetchData("test-123");
		expect(data.id).toBe("test-123");
		expect(typeof data.timestamp).toBe("number");

		// Test successful async operation
		const success = await instance.asyncWithError(false);
		expect(success).toBe("Success");

		// Test error in async operation
		const errorPromise = instance.asyncWithError(true);
		await expect(errorPromise).rejects.toThrow("Intentional error");
	});

	test("should handle promises returned from actions correctly", async (c) => {
		const promiseActor = actor({
			state: { results: [] as string[] },
			actions: {
				// Action that returns a resolved promise
				resolvedPromise: (c) => {
					return Promise.resolve("resolved value");
				},
				// Action that returns a promise that resolves after a delay
				delayedPromise: (c): Promise<string> => {
					const delayPromise = new Promise<string>((resolve) => {
						setTimeout(() => {
							c.state.results.push("delayed");
							resolve("delayed value");
						}, 50);
					});
					return vi.advanceTimersByTimeAsync(50).then(() => delayPromise);
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

		const app = setup({
			actors: { promiseActor },
		});

		const { client } = await setupTest<typeof app>(c, app);
		const instance = client.promiseActor.getOrCreate();

		// Test resolved promise
		const resolvedValue = await instance.resolvedPromise();
		expect(resolvedValue).toBe("resolved value");

		// Test delayed promise
		const delayedValue = await instance.delayedPromise();
		expect(delayedValue).toBe("delayed value");

		// Test rejected promise
		await expect(instance.rejectedPromise()).rejects.toThrow(
			"promised rejection",
		);

		// Check state was updated by the delayed promise
		const results = await instance.getResults();
		expect(results).toContain("delayed");
	});
});
