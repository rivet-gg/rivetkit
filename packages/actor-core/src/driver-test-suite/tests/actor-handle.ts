import { describe, test, expect, vi } from "vitest";
import type { DriverTestConfig } from "../mod";
import { setupDriverTest, waitFor } from "../utils";
import {
	COUNTER_APP_PATH,
	LIFECYCLE_APP_PATH,
	type CounterApp,
	type LifecycleApp,
} from "../test-apps";

export function runActorHandleTests(driverTestConfig: DriverTestConfig) {
	describe("Actor Handle Tests", () => {
		describe("Access Methods", () => {
			test("should use .get() to access an actor", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Create actor first
				await client.counter.create(["test-get-handle"]);

				// Access using get
				const handle = client.counter.get(["test-get-handle"]);

				// Verify RPC works
				const count = await handle.increment(5);
				expect(count).toBe(5);

				const retrievedCount = await handle.getCount();
				expect(retrievedCount).toBe(5);
			});

			test("should use .getForId() to access an actor by ID", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Create an actor first to get its ID
				const handle = client.counter.getOrCreate(["test-get-for-id-handle"]);
				await handle.increment(3);
				const actorId = await handle.resolve();

				// Access using getForId
				const idHandle = client.counter.getForId(actorId);

				// Verify RPC works and state is preserved
				const count = await idHandle.getCount();
				expect(count).toBe(3);

				const newCount = await idHandle.increment(4);
				expect(newCount).toBe(7);
			});

			test("should use .getOrCreate() to access or create an actor", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Access using getOrCreate - should create the actor
				const handle = client.counter.getOrCreate([
					"test-get-or-create-handle",
				]);

				// Verify RPC works
				const count = await handle.increment(7);
				expect(count).toBe(7);

				// Get the same actor again - should retrieve existing actor
				const sameHandle = client.counter.getOrCreate([
					"test-get-or-create-handle",
				]);
				const retrievedCount = await sameHandle.getCount();
				expect(retrievedCount).toBe(7);
			});

			test("should use (await create()) to create and return a handle", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Create actor and get handle
				const handle = await client.counter.create(["test-create-handle"]);

				// Verify RPC works
				const count = await handle.increment(9);
				expect(count).toBe(9);

				const retrievedCount = await handle.getCount();
				expect(retrievedCount).toBe(9);
			});
		});

		describe("RPC Functionality", () => {
			test("should call actions directly on the handle", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				const handle = client.counter.getOrCreate(["test-rpc-handle"]);

				// Call multiple actions in sequence
				const count1 = await handle.increment(3);
				expect(count1).toBe(3);

				const count2 = await handle.increment(5);
				expect(count2).toBe(8);

				const retrievedCount = await handle.getCount();
				expect(retrievedCount).toBe(8);
			});

			test("should handle independent handles to the same actor", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				// Create two handles to the same actor
				const handle1 = client.counter.getOrCreate(["test-multiple-handles"]);
				const handle2 = client.counter.get(["test-multiple-handles"]);

				// Call actions on both handles
				await handle1.increment(3);
				const count = await handle2.getCount();

				// Verify both handles access the same state
				expect(count).toBe(3);

				const finalCount = await handle2.increment(4);
				expect(finalCount).toBe(7);

				const checkCount = await handle1.getCount();
				expect(checkCount).toBe(7);
			});

			test("should resolve an actor's ID", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					COUNTER_APP_PATH,
				);

				const handle = client.counter.getOrCreate(["test-resolve-id"]);

				// Call an action to ensure actor exists
				await handle.increment(1);

				// Resolve the ID
				const actorId = await handle.resolve();

				// Verify we got a valid ID (string)
				expect(typeof actorId).toBe("string");
				expect(actorId).not.toBe("");

				// Verify we can use this ID to get the actor
				const idHandle = client.counter.getForId(actorId);
				const count = await idHandle.getCount();
				expect(count).toBe(1);
			});
		});

		describe("Lifecycle Hooks", () => {
			test("should trigger lifecycle hooks on actor creation", async (c) => {
				const { client } = await setupDriverTest<LifecycleApp>(
					c,
					driverTestConfig,
					LIFECYCLE_APP_PATH,
				);

				// Get or create a new actor - this should trigger onStart
				const handle = client.counter.getOrCreate(["test-lifecycle-handle"]);

				// Verify onStart was triggered
				const initialEvents = await handle.getEvents();
				expect(initialEvents).toContain("onStart");

				// Create a separate handle to the same actor
				const sameHandle = client.counter.getOrCreate([
					"test-lifecycle-handle",
				]);

				// Verify events still include onStart but don't duplicate it
				// (onStart should only be called once when the actor is first created)
				const events = await sameHandle.getEvents();
				expect(events).toContain("onStart");
				expect(events.filter((e) => e === "onStart").length).toBe(1);
			});

			test("should trigger connect/disconnect hooks when using connections", async (c) => {
				const { client } = await setupDriverTest<LifecycleApp>(
					c,
					driverTestConfig,
					LIFECYCLE_APP_PATH,
				);

				// Create the actor handle
				const handle = client.counter.getOrCreate([
					"test-lifecycle-connections",
				]);

				// Initial state should only have onStart
				const initialEvents = await handle.getEvents();
				expect(initialEvents).toContain("onStart");
				expect(initialEvents).not.toContain("onConnect");
				expect(initialEvents).not.toContain("onDisconnect");

				// Create a connection
				const connHandle = client.counter.getOrCreate(
					["test-lifecycle-connections"],
					{ params: { trackLifecycle: true } },
				);
				const connection = connHandle.connect();

				// HACK: Send action to check that it's fully connected and can make a RTT
				await connection.getEvents();

				// Should now have onBeforeConnect and onConnect events
				const eventsAfterConnect = await handle.getEvents();
				expect(eventsAfterConnect).toContain("onBeforeConnect");
				expect(eventsAfterConnect).toContain("onConnect");
				expect(eventsAfterConnect).not.toContain("onDisconnect");

				// Dispose the connection
				await connection.dispose();

				// Should now include onDisconnect
				const eventsAfterDisconnect = await handle.getEvents();
				expect(eventsAfterDisconnect).toContain("onDisconnect");
			});

			test("should allow multiple connections with correct lifecycle hooks", async (c) => {
				const { client } = await setupDriverTest<LifecycleApp>(
					c,
					driverTestConfig,
					LIFECYCLE_APP_PATH,
				);

				// Create the actor handle
				const handle = client.counter.getOrCreate(["test-lifecycle-multiple"]);

				// Create two connections
				const connHandle = client.counter.getOrCreate(
					["test-lifecycle-multiple"],
					{ params: { trackLifecycle: true } },
				);
				const conn1 = connHandle.connect();
				const conn2 = connHandle.connect();

				// HACK: Send action to check that it's fully connected and can make a RTT
				await conn1.getEvents();
				await conn2.getEvents();

				// Get events - should have 1 onStart, 2 each of onBeforeConnect and onConnect
				const events = await handle.getEvents();
				const startCount = events.filter((e) => e === "onStart").length;
				const beforeConnectCount = events.filter(
					(e) => e === "onBeforeConnect",
				).length;
				const connectCount = events.filter((e) => e === "onConnect").length;

				expect(startCount).toBe(1); // Only one onStart
				expect(beforeConnectCount).toBe(2); // Two onBeforeConnect
				expect(connectCount).toBe(2); // Two onConnect

				// Disconnect one connection
				await conn1.dispose();

				// Check events - should have 1 onDisconnect
				await vi.waitFor(async () => {
					const eventsAfterOneDisconnect = await handle.getEvents();
					const disconnectCount = eventsAfterOneDisconnect.filter(
						(e) => e === "onDisconnect",
					).length;
					expect(disconnectCount).toBe(1);
				});

				// Disconnect the second connection
				await conn2.dispose();

				// Check events - should have 2 onDisconnect
				await vi.waitFor(async () => {
					const eventsAfterAllDisconnect = await handle.getEvents();
					const finalDisconnectCount = eventsAfterAllDisconnect.filter(
						(e) => e === "onDisconnect",
					).length;
					expect(finalDisconnectCount).toBe(2);
				});
			});
		});
	});
}
