import { describe, test, expect, vi } from "vitest";
import {
	DriverTestConfigWithTransport,
	waitFor,
	type DriverTestConfig,
} from "@/mod";
import { setupDriverTest } from "@/utils";
import { resolve } from "node:path";
import type { App as CounterApp } from "../../fixtures/apps/counter";
import { ActorError } from "actor-core/client";

export function runManagerDriverTests(
	driverTestConfig: DriverTestConfigWithTransport,
) {
	describe("Manager Driver Tests", () => {
		describe("Client Connection Methods", () => {
			test("connect() - finds or creates an actor", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Basic connect() with no parameters creates a default actor
				const counterA = client.counter.getOrCreate();
				await counterA.increment(5);

				// Get the same actor again to verify state persisted
				const counterAAgain = client.counter.getOrCreate();
				const count = await counterAAgain.increment(0);
				expect(count).toBe(5);

				// Connect with key creates a new actor with specific parameters
				const counterB = client.counter.getOrCreate(["counter-b", "testing"]);

				await counterB.increment(10);
				const countB = await counterB.increment(0);
				expect(countB).toBe(10);
			});

			// TODO: Add back, createAndConnect is not valid logic
			//test("create() - always creates a new actor", async (c) => {
			//	const { client } = await setupDriverTest<CounterApp>(
			//		c,
			//		driverTestConfig,
			//		resolve(__dirname, "../fixtures/apps/counter.ts"),
			//	);
			//
			//	// Create with basic options
			//	const counterA = await client.counter.createAndConnect([
			//		"explicit-create",
			//	]);
			//	await counterA.increment(7);
			//
			//	// Create with the same ID should overwrite or return a conflict
			//	try {
			//		// Should either create a new actor with the same ID (overwriting)
			//		// or throw an error (if the driver prevents ID conflicts)
			//		const counterADuplicate = client.counter.createAndConnect([
			//			"explicit-create",
			//		]);
			//		await counterADuplicate.increment(1);
			//
			//		// If we get here, the driver allows ID overwrites
			//		// Verify that state was reset or overwritten
			//		const newCount = await counterADuplicate.increment(0);
			//		expect(newCount).toBe(1); // Not 8 (7+1) if it's a new instance
			//	} catch (error) {
			//		// This is also valid behavior if the driver prevents ID conflicts
			//		// No assertion needed
			//	}
			//
			//	// Create with full options
			//	const counterB = await client.counter.createAndConnect([
			//		"full-options",
			//		"testing",
			//		"counter",
			//	]);
			//
			//	await counterB.increment(3);
			//	const countB = await counterB.increment(0);
			//	expect(countB).toBe(3);
			//});
		});

		describe("Connection Options", () => {
			test("get without create prevents actor creation", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Try to get a nonexistent actor with no create
				const nonexistentId = `nonexistent-${crypto.randomUUID()}`;

				// Should fail when actor doesn't exist
				let counter1Error: ActorError;
				const counter1 = client.counter.get([nonexistentId]).connect();
				counter1.onError((e) => {
					counter1Error = e;
				});
				await vi.waitFor(
					() => expect(counter1Error).toBeInstanceOf(ActorError),
					500,
				);
				await counter1.dispose();

				// Create the actor
				const createdCounter = client.counter.getOrCreate(nonexistentId);
				await createdCounter.increment(3);

				// Now no create should work since the actor exists
				const retrievedCounter = client.counter.get(nonexistentId);

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
				const counter = client.counter.getOrCreate(undefined, {
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
				const uniqueId = `test-counter-${crypto.randomUUID()}`;

				// Create actor with specific ID
				const counter = client.counter.getOrCreate([uniqueId]);
				await counter.increment(10);

				// Retrieve the same actor by ID and verify state
				const retrievedCounter = client.counter.getOrCreate([uniqueId]);
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
			//	const counter = client.counter.getOrCreate({
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
			//	const retrievedCounter = client.counter.getOrCreate(["metadata-test"]);
			//
			//	// Verify it's the same instance
			//	const count = await retrievedCounter.increment(0);
			//	expect(count).toBe(42);
			//});
		});

		describe("Key Matching", () => {
			test("matches actors only with exactly the same keys", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create actor with multiple keys
				const originalCounter = client.counter.getOrCreate([
					"counter-match",
					"test",
					"us-east",
				]);
				await originalCounter.increment(10);

				// Should match with exact same keys
				const exactMatchCounter = client.counter.getOrCreate([
					"counter-match",
					"test",
					"us-east",
				]);
				const exactMatchCount = await exactMatchCounter.increment(0);
				expect(exactMatchCount).toBe(10);

				// Should NOT match with subset of keys - should create new actor
				const subsetMatchCounter = client.counter.getOrCreate([
					"counter-match",
					"test",
				]);
				const subsetMatchCount = await subsetMatchCounter.increment(0);
				expect(subsetMatchCount).toBe(0); // Should be a new counter with 0

				// Should NOT match with just one key - should create new actor
				const singleKeyCounter = client.counter.getOrCreate(["counter-match"]);
				const singleKeyCount = await singleKeyCounter.increment(0);
				expect(singleKeyCount).toBe(0); // Should be a new counter with 0
			});

			test("string key matches array with single string key", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create actor with string key
				const stringKeyCounter = client.counter.getOrCreate("string-key-test");
				await stringKeyCounter.increment(7);

				// Should match with equivalent array key
				const arrayKeyCounter = client.counter.getOrCreate(["string-key-test"]);
				const count = await arrayKeyCounter.increment(0);
				expect(count).toBe(7);
			});

			test("undefined key matches empty array key and no key", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create actor with undefined key
				const undefinedKeyCounter = client.counter.getOrCreate(undefined);
				await undefinedKeyCounter.increment(12);

				// Should match with empty array key
				const emptyArrayKeyCounter = client.counter.getOrCreate([]);
				const emptyArrayCount = await emptyArrayKeyCounter.increment(0);
				expect(emptyArrayCount).toBe(12);

				// Should match with no key
				const noKeyCounter = client.counter.getOrCreate();
				const noKeyCount = await noKeyCounter.increment(0);
				expect(noKeyCount).toBe(12);
			});

			test("no keys does not match actors with keys", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create counter with keys
				const keyedCounter = client.counter.getOrCreate([
					"counter-with-keys",
					"special",
				]);
				await keyedCounter.increment(15);

				// Should not match when searching with no keys
				const noKeysCounter = client.counter.getOrCreate();
				const count = await noKeysCounter.increment(10);
				expect(count).toBe(10);
			});

			test("actors with keys match actors with no keys", async (c) => {
				const { client } = await setupDriverTest<CounterApp>(
					c,
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create a counter with no keys
				const noKeysCounter = client.counter.getOrCreate();
				await noKeysCounter.increment(25);

				// Get counter with keys - should create a new one
				const keyedCounter = client.counter.getOrCreate([
					"new-counter",
					"prod",
				]);
				const keyedCount = await keyedCounter.increment(0);

				// Should be a new counter, not the one created above
				expect(keyedCount).toBe(0);
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
			//	const instance1 = client.counter.getOrCreate(["multi-1"]);
			//	const instance2 = client.counter.getOrCreate(["multi-2"]);
			//	const instance3 = client.counter.getOrCreate(["multi-3"]);
			//
			//	// Set different states
			//	await instance1.increment(1);
			//	await instance2.increment(2);
			//	await instance3.increment(3);
			//
			//	// Retrieve all instances again
			//	const retrieved1 = client.counter.getOrCreate(["multi-1"]);
			//	const retrieved2 = client.counter.getOrCreate(["multi-2"]);
			//	const retrieved3 = client.counter.getOrCreate(["multi-3"]);
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
				const defaultCounter = client.counter.getOrCreate();

				// Set state
				await defaultCounter.increment(5);

				// Get default instance again
				const sameDefaultCounter = client.counter.getOrCreate();

				// Verify state is maintained
				const count = await sameDefaultCounter.increment(0);
				expect(count).toBe(5);
			});
		});
	});
}
