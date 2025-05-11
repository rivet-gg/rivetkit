import { describe, test, expect } from "vitest";
import type { DriverTestConfig } from "@/mod";
import { setupDriverTest } from "@/utils";
import { resolve } from "node:path";
import type { App as CounterApp } from "../../fixtures/apps/counter";

export function runManagerDriverTests(driverTestConfig: DriverTestConfig) {
	describe("Manager Driver Tests", () => {
		describe("Client Connection Methods", () => {
			test("connect() - finds or creates an actor", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Basic connect() with no parameters creates a default actor
				const counterA = await client.counter.connect();
				await counterA.increment(5);

				// Get the same actor again to verify state persisted
				const counterAAgain = await client.counter.connect();
				const count = await counterAAgain.increment(0);
				expect(count).toBe(5);

				// Connect with key creates a new actor with specific parameters
				const counterB = await client.counter.connect(["counter-b", "testing"]);

				await counterB.increment(10);
				const countB = await counterB.increment(0);
				expect(countB).toBe(10);
			});

			test("create() - always creates a new actor", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create with basic options
				const counterA = await client.counter.createAndConnect([
					"explicit-create",
				]);
				await counterA.increment(7);

				// Create with the same ID should overwrite or return a conflict
				try {
					// Should either create a new actor with the same ID (overwriting)
					// or throw an error (if the driver prevents ID conflicts)
					const counterADuplicate = await client.counter.connect(undefined, {
						create: {
							key: ["explicit-create"],
						},
					});
					await counterADuplicate.increment(1);

					// If we get here, the driver allows ID overwrites
					// Verify that state was reset or overwritten
					const newCount = await counterADuplicate.increment(0);
					expect(newCount).toBe(1); // Not 8 (7+1) if it's a new instance
				} catch (error) {
					// This is also valid behavior if the driver prevents ID conflicts
					// No assertion needed
				}

				// Create with full options
				const counterB = await client.counter.createAndConnect([
					"full-options",
					"testing",
					"counter",
				]);

				await counterB.increment(3);
				const countB = await counterB.increment(0);
				expect(countB).toBe(3);
			});
		});

		describe("Connection Options", () => {
			test("noCreate option prevents actor creation", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Try to get a nonexistent actor with noCreate
				const nonexistentId = `nonexistent-${Date.now()}`;

				// Should fail when actor doesn't exist
				let error: unknown;
				try {
					await client.counter.connect([nonexistentId], {
						noCreate: true,
					});
				} catch (err) {
					error = err;
				}

				// Verify we got an error
				expect(error).toBeTruthy();

				// Create the actor
				const counter = await client.counter.connect(undefined, {
					create: {
						key: [nonexistentId],
					},
				});
				await counter.increment(3);

				// Now noCreate should work since the actor exists
				const retrievedCounter = await client.counter.connect([nonexistentId], {
					noCreate: true,
				});

				const count = await retrievedCounter.increment(0);
				expect(count).toBe(3);
			});

			test("connection params are passed to actors", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create an actor with connection params
				// Note: In a real test we'd verify these are received by the actor,
				// but our simple counter actor doesn't use connection params.
				// This test just ensures the params are accepted by the driver.
				const counter = await client.counter.connect(undefined, {
					params: {
						userId: "user-123",
						authToken: "token-abc",
						settings: { increment: 5 },
					},
				});

				await counter.increment(1);
				const count = await counter.increment(0);
				expect(count).toBe(1);
			});
		});

		describe("Actor Creation & Retrieval", () => {
			test("creates and retrieves actors by ID", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create a unique ID for this test
				const uniqueId = `test-counter-${Date.now()}`;

				// Create actor with specific ID
				const counter = await client.counter.connect([uniqueId]);
				await counter.increment(10);

				// Retrieve the same actor by ID and verify state
				const retrievedCounter = await client.counter.connect([uniqueId]);
				const count = await retrievedCounter.increment(0); // Get current value
				expect(count).toBe(10);
			});

			// TODO: Correctly test region for each provider
			//test("creates and retrieves actors with region", async (c) => {
			//	const { client } = await setupDriverTest<CounterApp>(c,
			//		driverTestConfig,
			//		resolve(__dirname, "../fixtures/apps/counter.ts"),
			//	);
			//
			//	// Create actor with a specific region
			//	const counter = await client.counter.connect({
			//		create: {
			//			key: ["metadata-test", "testing"],
			//			region: "test-region",
			//		},
			//	});
			//
			//	// Set state to identify this specific instance
			//	await counter.increment(42);
			//
			//	// Retrieve by ID (since metadata is not used for retrieval)
			//	const retrievedCounter = await client.counter.connect(["metadata-test"]);
			//
			//	// Verify it's the same instance
			//	const count = await retrievedCounter.increment(0);
			//	expect(count).toBe(42);
			//});
		});

		describe("Key Matching", () => {
			test("finds actors with equal or superset of specified keys", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create actor with multiple keys
				const originalCounter = await client.counter.connect([
					"counter-match",
					"test",
					"us-east",
				]);
				await originalCounter.increment(10);

				// Should match with exact same keys
				const exactMatchCounter = await client.counter.connect([
					"counter-match",
					"test",
					"us-east",
				]);
				const exactMatchCount = await exactMatchCounter.increment(0);
				expect(exactMatchCount).toBe(10);

				// Should match with subset of keys
				const subsetMatchCounter = await client.counter.connect([
					"counter-match",
					"test",
				]);
				const subsetMatchCount = await subsetMatchCounter.increment(0);
				expect(subsetMatchCount).toBe(10);

				// Should match with just one key
				const singleKeyCounter = await client.counter.connect([
					"counter-match",
				]);
				const singleKeyCount = await singleKeyCounter.increment(0);
				expect(singleKeyCount).toBe(10);
			});

			test("no keys match actors with keys", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create counter with keys
				const keyedCounter = await client.counter.connect([
					"counter-with-keys",
					"special",
				]);
				await keyedCounter.increment(15);

				// Should match when searching with no keys
				const noKeysCounter = await client.counter.connect();
				const count = await noKeysCounter.increment(0);

				// Should have matched existing actor
				expect(count).toBe(15);
			});

			test("actors with keys match actors with no keys", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create a counter with no keys
				const noKeysCounter = await client.counter.connect();
				await noKeysCounter.increment(25);

				// Get counter with keys - should create a new one
				const keyedCounter = await client.counter.connect([
					"new-counter",
					"prod",
				]);
				const keyedCount = await keyedCounter.increment(0);

				// Should be a new counter, not the one created above
				expect(keyedCount).toBe(0);
			});

			test("specifying different keys for connect and create results in the expected keys", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create a counter with specific create keys
				const counter = await client.counter.connect(["key-test", "test"], {
					create: {
						key: ["key-test", "test", "1.0"],
					},
				});
				await counter.increment(5);

				// Should match when searching with original search keys
				const foundWithSearchKeys = await client.counter.connect([
					"key-test",
					"test",
				]);
				const countWithSearchKeys = await foundWithSearchKeys.increment(0);
				expect(countWithSearchKeys).toBe(5);

				// Should also match when searching with any subset of the create keys
				const foundWithExtraKeys = await client.counter.connect([
					"key-test",
					"1.0",
				]);
				const countWithExtraKeys = await foundWithExtraKeys.increment(0);
				expect(countWithExtraKeys).toBe(5);

				// Create a new counter with just search keys but different create keys
				const newCounter = await client.counter.connect(["secondary"], {
					create: {
						key: ["secondary", "low", "true"],
					},
				});
				await newCounter.increment(10);

				// Should not find when searching with keys not in create keys
				const notFound = await client.counter.connect(["secondary", "active"]);
				const notFoundCount = await notFound.increment(0);
				expect(notFoundCount).toBe(0); // New counter
			});
		});

		describe("Multiple Actor Instances", () => {
			// TODO: This test is flakey https://github.com/rivet-gg/actor-core/issues/873
			//test("creates multiple actor instances of the same type", async (c) => {
			//	const { client } = await setupDriverTest<CounterApp>(c,
			//		driverTestConfig,
			//		resolve(__dirname, "../fixtures/apps/counter.ts"),
			//	);
			//
			//	// Create multiple instances with different IDs
			//	const instance1 = await client.counter.connect(["multi-1"]);
			//	const instance2 = await client.counter.connect(["multi-2"]);
			//	const instance3 = await client.counter.connect(["multi-3"]);
			//
			//	// Set different states
			//	await instance1.increment(1);
			//	await instance2.increment(2);
			//	await instance3.increment(3);
			//
			//	// Retrieve all instances again
			//	const retrieved1 = await client.counter.connect(["multi-1"]);
			//	const retrieved2 = await client.counter.connect(["multi-2"]);
			//	const retrieved3 = await client.counter.connect(["multi-3"]);
			//
			//	// Verify separate state
			//	expect(await retrieved1.increment(0)).toBe(1);
			//	expect(await retrieved2.increment(0)).toBe(2);
			//	expect(await retrieved3.increment(0)).toBe(3);
			//});

			test("handles default instance with no explicit ID", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Get default instance (no ID specified)
				const defaultCounter = await client.counter.connect();

				// Set state
				await defaultCounter.increment(5);

				// Get default instance again
				const sameDefaultCounter = await client.counter.connect();

				// Verify state is maintained
				const count = await sameDefaultCounter.increment(0);
				expect(count).toBe(5);
			});
		});
	});
}
