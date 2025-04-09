import { actor, setup } from "@/mod";
import { describe, test, expect, vi } from "vitest";
import { setupTest } from "@/test/mod";

describe("Action Timeout", () => {
	test("should timeout actions that exceed the configured timeout", async (c) => {
		// Create an actor with a custom timeout of 100ms
		const timeoutActor = actor({
			state: { value: 0 },
			options: {
				action: {
					timeout: 100, // 100ms timeout
				},
			},
			actions: {
				// Quick action that should succeed
				quickAction: async (c) => {
					return "quick response";
				},
				// Slow action that should timeout
				slowAction: async (c) => {
					// Start a promise that resolves after 500ms
					const delayPromise = new Promise((resolve) =>
						setTimeout(resolve, 500),
					);

					// Advance only to the timeout threshold to trigger the timeout
					await vi.advanceTimersByTimeAsync(150);

					// The action should have timed out by now, but we'll try to return a value
					// This return should never happen because the timeout should occur first
					await delayPromise;
					return "slow response";
				},
			},
		});

		const app = setup({
			actors: { timeoutActor },
		});

		const { client } = await setupTest<typeof app>(c, app);
		const instance = await client.timeoutActor.get();

		// The quick action should complete successfully
		const quickResult = await instance.quickAction();
		expect(quickResult).toBe("quick response");

		// The slow action should throw a timeout error
		await expect(instance.slowAction()).rejects.toThrow("Action timed out.");
	});

	test("should respect the default timeout", async (c) => {
		// Create an actor with the default timeout (60000ms)
		const defaultTimeoutActor = actor({
			state: { value: 0 },
			actions: {
				// This should complete within the default timeout
				normalAction: async (c) => {
					const delayPromise = new Promise((resolve) =>
						setTimeout(resolve, 50),
					);
					await vi.advanceTimersByTimeAsync(50);
					await delayPromise;
					return "normal response";
				},
			},
		});

		const app = setup({
			actors: { defaultTimeoutActor },
		});

		const { client } = await setupTest<typeof app>(c, app);
		const instance = await client.defaultTimeoutActor.get();

		// This action should complete successfully
		const result = await instance.normalAction();
		expect(result).toBe("normal response");
	});

	test("non-promise action results should not be affected by timeout", async (c) => {
		// Create an actor that returns non-promise values
		const syncActor = actor({
			state: { value: 0 },
			options: {
				action: {
					timeout: 100, // 100ms timeout
				},
			},
			actions: {
				// Synchronous action that returns immediately
				syncAction: (c) => {
					return "sync response";
				},
			},
		});

		const app = setup({
			actors: { syncActor },
		});

		const { client } = await setupTest<typeof app>(c, app);
		const instance = await client.syncActor.get();

		// Synchronous action should not be affected by timeout
		const result = await instance.syncAction();
		expect(result).toBe("sync response");
	});

	test("should allow configuring different timeouts for different actors", async (c) => {
		// Create an actor with a very short timeout
		const shortTimeoutActor = actor({
			state: { value: 0 },
			options: {
				action: {
					timeout: 50, // 50ms timeout
				},
			},
			actions: {
				delayedAction: async (c) => {
					// Start a promise that resolves after 100ms
					const delayPromise = new Promise((resolve) =>
						setTimeout(resolve, 100),
					);

					// Advance past the timeout threshold
					await vi.advanceTimersByTimeAsync(70);

					// The action should have timed out by now
					await delayPromise;
					return "delayed response";
				},
			},
		});

		// Create an actor with a longer timeout
		const longerTimeoutActor = actor({
			state: { value: 0 },
			options: {
				action: {
					timeout: 200, // 200ms timeout
				},
			},
			actions: {
				delayedAction: async (c) => {
					// Start a promise that resolves after 100ms
					const delayPromise = new Promise((resolve) =>
						setTimeout(resolve, 100),
					);

					// Advance less than the timeout threshold
					await vi.advanceTimersByTimeAsync(100);

					// This should complete before the timeout
					await delayPromise;
					return "delayed response";
				},
			},
		});

		const app = setup({
			actors: {
				shortTimeoutActor,
				longerTimeoutActor,
			},
		});

		const { client } = await setupTest<typeof app>(c, app);

		// The short timeout actor should fail
		const shortInstance = await client.shortTimeoutActor.get();
		await expect(shortInstance.delayedAction()).rejects.toThrow(
			"Action timed out.",
		);

		// The longer timeout actor should succeed
		const longerInstance = await client.longerTimeoutActor.get();
		const result = await longerInstance.delayedAction();
		expect(result).toBe("delayed response");
	});
});
