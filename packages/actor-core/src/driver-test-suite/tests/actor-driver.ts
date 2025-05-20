import { describe, test, expect, vi } from "vitest";
import type { DriverTestConfig, DriverTestConfigWithTransport } from "../mod";
import { setupDriverTest } from "../utils";
import {
	COUNTER_APP_PATH,
	SCHEDULED_APP_PATH,
	type CounterApp,
	type ScheduledApp,
} from "../test-apps";

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
export function runActorDriverTests(
	driverTestConfig: DriverTestConfigWithTransport,
) {
	describe("Actor Driver Tests", () => {
		describe("State Persistence", () => {
			test("persists state between actor instances", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Create instance and increment
				const counterInstance = client.counter.getOrCreate();
				const initialCount = await counterInstance.increment(5);
				expect(initialCount).toBe(5);

				// Get a fresh reference to the same actor and verify state persisted
				const sameInstance = client.counter.getOrCreate();
				const persistedCount = await sameInstance.increment(3);
				expect(persistedCount).toBe(8);
			});

			test("restores state after actor disconnect/reconnect", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Create actor and set initial state
				const counterInstance = client.counter.getOrCreate();
				await counterInstance.increment(5);

				// Reconnect to the same actor
				const reconnectedInstance = client.counter.getOrCreate();
				const persistedCount = await reconnectedInstance.increment(0);
				expect(persistedCount).toBe(5);
			});

			test("maintains separate state for different actors", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Create first counter with specific key
				const counterA = client.counter.getOrCreate(["counter-a"]);
				await counterA.increment(5);

				// Create second counter with different key
				const counterB = client.counter.getOrCreate(["counter-b"]);
				await counterB.increment(10);

				// Verify state is separate
				const countA = await counterA.increment(0);
				const countB = await counterB.increment(0);
				expect(countA).toBe(5);
				expect(countB).toBe(10);
			});
		});

		describe("Scheduled Alarms", () => {
			test("executes scheduled alarms", async (c) => {
				const { client } = await setupDriverTest<ScheduledApp>(
					c,
					driverTestConfig,
					SCHEDULED_APP_PATH,
				);

				// Create instance
				const alarmInstance = client.scheduled.getOrCreate();

				// Schedule a task to run in 100ms
				await alarmInstance.scheduleTask(100);

				// Wait for longer than the scheduled time
				await waitFor(driverTestConfig, 150);

				// Verify the scheduled task ran
				const lastRun = await alarmInstance.getLastRun();
				const scheduledCount = await alarmInstance.getScheduledCount();

				expect(lastRun).toBeGreaterThan(0);
				expect(scheduledCount).toBe(1);
			});
		});

		describe("Actor Handle", () => {
			test("stateless handle can perform RPC calls", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Get a handle to an actor
				const counterHandle = client.counter.getOrCreate("test-handle");
				await counterHandle.increment(1);
				await counterHandle.increment(2);
				const count = await counterHandle.getCount();
				expect(count).toBe(3);
			});

			test("stateless handles to same actor share state", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Get a handle to an actor
				const handle1 = client.counter.getOrCreate("test-handle-shared");
				await handle1.increment(5);

				// Get another handle to same actor
				const handle2 = client.counter.getOrCreate("test-handle-shared");
				const count = await handle2.getCount();
				expect(count).toBe(5);
			});
		});
	});
}
