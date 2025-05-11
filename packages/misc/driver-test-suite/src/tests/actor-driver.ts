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
				const counterInstance = await client.counter.connect();
				const initialCount = await counterInstance.increment(5);
				expect(initialCount).toBe(5);

				// Get a fresh reference to the same actor and verify state persisted
				const sameInstance = await client.counter.connect();
				const persistedCount = await sameInstance.increment(3);
				expect(persistedCount).toBe(8);
			});

			test("restores state after actor disconnect/reconnect", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create actor and set initial state
				const counterInstance = await client.counter.connect();
				await counterInstance.increment(5);
				
				// Disconnect the actor
				await counterInstance.dispose();

				// Reconnect to the same actor
				const reconnectedInstance = await client.counter.connect();
				const persistedCount = await reconnectedInstance.increment(0);
				expect(persistedCount).toBe(5);
			});

			test("maintains separate state for different actors", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create first counter with specific key
				const counterA = await client.counter.connect(["counter-a"]);
				await counterA.increment(5);
				
				// Create second counter with different key
				const counterB = await client.counter.connect(["counter-b"]);
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
					resolve(__dirname, "../fixtures/apps/scheduled.ts"),
				);

				// Create instance
				const alarmInstance = await client.scheduled.connect();
				
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
	});
}