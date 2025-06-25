import { describe, expect, test } from "vitest";
import type { DriverTestConfig } from "../mod";
import { setupDriverTest, waitFor } from "../utils";

export function runActorScheduleTests(driverTestConfig: DriverTestConfig) {
	describe("Actor Schedule Tests", () => {
		describe("Scheduled Alarms", () => {
			test("executes c.schedule.at() with specific timestamp", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create instance
				const scheduled = client.scheduled.getOrCreate();

				// Schedule a task to run in 100ms using timestamp
				const timestamp = Date.now() + 100;
				await scheduled.scheduleTaskAt(timestamp);

				// Wait for longer than the scheduled time
				await waitFor(driverTestConfig, 150);

				// Verify the scheduled task ran
				const lastRun = await scheduled.getLastRun();
				const scheduledCount = await scheduled.getScheduledCount();

				expect(lastRun).toBeGreaterThan(0);
				expect(scheduledCount).toBe(1);
			});

			test("executes c.schedule.after() with delay", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create instance
				const scheduled = client.scheduled.getOrCreate();

				// Schedule a task to run in 100ms using delay
				await scheduled.scheduleTaskAfter(100);

				// Wait for longer than the scheduled time
				await waitFor(driverTestConfig, 150);

				// Verify the scheduled task ran
				const lastRun = await scheduled.getLastRun();
				const scheduledCount = await scheduled.getScheduledCount();

				expect(lastRun).toBeGreaterThan(0);
				expect(scheduledCount).toBe(1);
			});

			test("scheduled tasks persist across actor restarts", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create instance and schedule
				const scheduled = client.scheduled.getOrCreate();
				await scheduled.scheduleTaskAfter(200);

				// Wait a little so the schedule is stored but hasn't triggered yet
				await waitFor(driverTestConfig, 50);

				// Get a new reference to simulate actor restart
				const newInstance = client.scheduled.getOrCreate();

				// Verify the schedule still exists but hasn't run yet
				const initialCount = await newInstance.getScheduledCount();
				expect(initialCount).toBe(0);

				// Wait for the scheduled task to execute
				await waitFor(driverTestConfig, 200);

				// Verify the scheduled task ran after "restart"
				const scheduledCount = await newInstance.getScheduledCount();
				expect(scheduledCount).toBe(1);
			});

			test("multiple scheduled tasks execute in order", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create instance
				const scheduled = client.scheduled.getOrCreate();

				// Reset history to start fresh
				await scheduled.clearHistory();

				// Schedule multiple tasks with different delays
				await scheduled.scheduleTaskAfterWithId("first", 50);
				await scheduled.scheduleTaskAfterWithId("second", 150);
				await scheduled.scheduleTaskAfterWithId("third", 250);

				// Wait for first task only
				await waitFor(driverTestConfig, 100);
				const history1 = await scheduled.getTaskHistory();
				expect(history1).toEqual(["first"]);

				// Wait for second task
				await waitFor(driverTestConfig, 100);
				const history2 = await scheduled.getTaskHistory();
				expect(history2).toEqual(["first", "second"]);

				// Wait for third task
				await waitFor(driverTestConfig, 100);
				const history3 = await scheduled.getTaskHistory();
				expect(history3).toEqual(["first", "second", "third"]);
			});
		});
	});
}
