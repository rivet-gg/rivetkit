import { describe, test, expect, vi } from "vitest";
import type { DriverTestConfig } from "@/mod";
import { setupDriverTest } from "@/utils";
import { resolve } from "node:path";
import type { App as CounterApp } from "../../fixtures/apps/counter";
import type { App as ScheduledApp } from "../../fixtures/apps/scheduled";

/**
 * Waits for the specified time, using either real setTimeout or vi.advanceTimersByTime
 * based on the driverTestConfig.
 */
export async function waitFor(
	driverTestConfig: DriverTestConfig,
	ms: number,
): Promise<void> {
	if (driverTestConfig.useRealTimers) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	} else {
		vi.advanceTimersByTime(ms);
		return Promise.resolve();
	}
}
export function runActorDriverTests(driverTestConfig: DriverTestConfig) {
	describe("Actor Driver Tests", () => {
		describe("State Persistence", () => {
			test("persists state between actor instances", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create instance and increment
				const counterInstance = await client.counter.get();
				const initialCount = await counterInstance.increment(5);
				expect(initialCount).toBe(5);

				// Get a fresh reference to the same actor and verify state persisted
				const sameInstance = await client.counter.get();
				const persistedCount = await sameInstance.increment(3);
				expect(persistedCount).toBe(8); // 5 + 3 = 8
			});

			test("maintains separate state between different actor IDs", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create two counters with different IDs
				const counterOne = await client.counter.get({
					tags: { id: "counter-1" },
				});
				const counterTwo = await client.counter.get({
					tags: { id: "counter-2" },
				});

				// Set different values
				await counterOne.increment(10);
				await counterTwo.increment(20);

				// Verify they maintained separate states
				const counterOneRefresh = await client.counter.get({
					tags: { id: "counter-1" },
				});
				const counterTwoRefresh = await client.counter.get({
					tags: { id: "counter-2" },
				});

				const countOne = await counterOneRefresh.increment(0); // Get current value
				const countTwo = await counterTwoRefresh.increment(0); // Get current value

				expect(countOne).toBe(10);
				expect(countTwo).toBe(20);
			});
		});

		describe("Actor Scheduling", () => {
			test("schedules and executes tasks", async (c) => {
				const { client } = await setupDriverTest<ScheduledApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/scheduled.ts"),
				);

				// Get the scheduled actor
				const scheduledActor = await client.scheduled.get();

				// Schedule a task to run in 100ms
				const scheduledTime = await scheduledActor.scheduleTask(100);
				expect(scheduledTime).toBeGreaterThan(Date.now());

				// Advance time by 150ms and run any pending timers
				await waitFor(driverTestConfig, 150);

				// Verify the scheduled task ran
				const count = await scheduledActor.getScheduledCount();
				expect(count).toBe(1);

				const lastRun = await scheduledActor.getLastRun();
				expect(lastRun).toBeGreaterThan(0);
			});

			// TODO: https://github.com/rivet-gg/actor-core/issues/877
			//test("schedules multiple tasks correctly", async (c) => {
			//	const { client } = await setupDriverTest<ScheduledApp>(c,
			//		driverTestConfig,
			//		resolve(__dirname, "../fixtures/apps/scheduled.ts"),
			//	);
			//
			//	// Create a new scheduled actor with unique ID
			//	const scheduledActor = await client.scheduled.get();
			//
			//	// Schedule multiple tasks with different delays
			//	await scheduledActor.scheduleTask(50);
			//	await scheduledActor.scheduleTask(150);
			//
			//	// Advance time by 75ms - should execute only the first task
			//	await waitFor(driverTestConfig, 75);
			//
			//	// Verify first task ran
			//	let count = await scheduledActor.getScheduledCount();
			//	expect(count).toBe(1);
			//
			//	// Advance time by another 100ms to execute the second task
			//	await waitFor(driverTestConfig, 100);
			//
			//	// Verify both tasks ran
			//	count = await scheduledActor.getScheduledCount();
			//	expect(count).toBe(2);
			//});
		});
	});
}
