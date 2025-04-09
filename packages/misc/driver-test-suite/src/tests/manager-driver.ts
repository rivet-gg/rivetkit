import { describe, test, expect } from "vitest";
import type { DriverTestConfig } from "@/mod";
import { setupDriverTest } from "@/utils";
import { resolve } from "node:path";
import type { App as CounterApp } from "../../fixtures/apps/counter";

export function runManagerDriverTests(driverTestConfig: DriverTestConfig) {
	describe("Manager Driver Tests", () => {
		describe("Client Connection Methods", () => {
			test("get() - finds or creates an actor", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Basic get() with no parameters creates a default actor
				const counterA = await client.counter.get();
				await counterA.increment(5);

				// Get the same actor again to verify state persisted
				const counterAAgain = await client.counter.get();
				const count = await counterAAgain.increment(0);
				expect(count).toBe(5);

				// Get with tags creates a new actor with specific parameters
				const counterB = await client.counter.get({
					tags: { id: "counter-b", purpose: "testing" },
				});

				await counterB.increment(10);
				const countB = await counterB.increment(0);
				expect(countB).toBe(10);
			});

			test("create() - always creates a new actor", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create with basic options
				const counterA = await client.counter.create({
					create: {
						tags: { id: "explicit-create" },
					},
				});
				await counterA.increment(7);

				// Create with the same ID should overwrite or return a conflict
				try {
					// Should either create a new actor with the same ID (overwriting)
					// or throw an error (if the driver prevents ID conflicts)
					const counterADuplicate = await client.counter.create({
						create: {
							tags: { id: "explicit-create" },
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
				const counterB = await client.counter.create({
					create: {
						tags: { id: "full-options", purpose: "testing", type: "counter" },
						// TODO: Test this
						//region: "us-east-1", // Optional region parameter
					},
				});

				await counterB.increment(3);
				const countB = await counterB.increment(0);
				expect(countB).toBe(3);
			});
		});

		describe("Connection Options", () => {
			test("noCreate option prevents actor creation", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Try to get a nonexistent actor with noCreate
				const nonexistentId = `nonexistent-${Date.now()}`;

				// Should fail when actor doesn't exist
				let error: unknown;
				try {
					await client.counter.get({
						tags: { id: nonexistentId },
						noCreate: true,
					});
				} catch (err) {
					error = err;
				}

				// Verify we got an error
				expect(error).toBeTruthy();

				// Create the actor
				const counter = await client.counter.create({
					create: {
						tags: { id: nonexistentId },
					},
				});
				await counter.increment(3);

				// Now noCreate should work since the actor exists
				const retrievedCounter = await client.counter.get({
					tags: { id: nonexistentId },
					noCreate: true,
				});

				const count = await retrievedCounter.increment(0);
				expect(count).toBe(3);
			});

			test("connection params are passed to actors", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create an actor with connection params
				// Note: In a real test we'd verify these are received by the actor,
				// but our simple counter actor doesn't use connection params.
				// This test just ensures the params are accepted by the driver.
				const counter = await client.counter.get({
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
			test("creates and retrieves actors by ID", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create a unique ID for this test
				const uniqueId = `test-counter-${Date.now()}`;

				// Create actor with specific ID
				const counter = await client.counter.get({
					tags: { id: uniqueId },
				});
				await counter.increment(10);

				// Retrieve the same actor by ID and verify state
				const retrievedCounter = await client.counter.get({
					tags: { id: uniqueId },
				});
				const count = await retrievedCounter.increment(0); // Get current value
				expect(count).toBe(10);
			});

			// TODO: Correctly test region for each provider
			//test("creates and retrieves actors with region", async () => {
			//	const { client } = await setupDriverTest<CounterApp>(
			//		driverTestConfig,
			//		resolve(__dirname, "../fixtures/apps/counter.ts"),
			//	);
			//
			//	// Create actor with a specific region
			//	const counter = await client.counter.create({
			//		create: {
			//			tags: { id: "metadata-test", purpose: "testing" },
			//			region: "test-region",
			//		},
			//	});
			//
			//	// Set state to identify this specific instance
			//	await counter.increment(42);
			//
			//	// Retrieve by ID (since metadata is not used for retrieval)
			//	const retrievedCounter = await client.counter.get({
			//		tags: { id: "metadata-test" },
			//	});
			//
			//	// Verify it's the same instance
			//	const count = await retrievedCounter.increment(0);
			//	expect(count).toBe(42);
			//});
		});

		describe("Tag Matching", () => {
			test("finds actors with equal or superset of specified tags", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create actor with multiple tags
				const originalCounter = await client.counter.get({
					tags: { id: "counter-match", environment: "test", region: "us-east" },
				});
				await originalCounter.increment(10);

				// Should match with exact same tags
				const exactMatchCounter = await client.counter.get({
					tags: { id: "counter-match", environment: "test", region: "us-east" },
				});
				const exactMatchCount = await exactMatchCounter.increment(0);
				expect(exactMatchCount).toBe(10);

				// Should match with subset of tags
				const subsetMatchCounter = await client.counter.get({
					tags: { id: "counter-match", environment: "test" },
				});
				const subsetMatchCount = await subsetMatchCounter.increment(0);
				expect(subsetMatchCount).toBe(10);

				// Should match with just one tag
				const singleTagCounter = await client.counter.get({
					tags: { id: "counter-match" },
				});
				const singleTagCount = await singleTagCounter.increment(0);
				expect(singleTagCount).toBe(10);
			});

			test("no tags match actors with tags", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create counter with tags
				const taggedCounter = await client.counter.get({
					tags: { id: "counter-with-tags", type: "special" },
				});
				await taggedCounter.increment(15);

				// Should match when searching with no tags
				const noTagsCounter = await client.counter.get();
				const count = await noTagsCounter.increment(0);

				// Should have matched existing actor
				expect(count).toBe(15);
			});

			test("actors with tags match actors with no tags", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create a counter with no tags
				const noTagsCounter = await client.counter.get();
				await noTagsCounter.increment(25);

				// Get counter with tags - should create a new one
				const taggedCounter = await client.counter.get({
					tags: { id: "new-counter", environment: "prod" },
				});
				const taggedCount = await taggedCounter.increment(0);

				// Should be a new counter, not the one created above
				expect(taggedCount).toBe(0);
			});

			test("specifying different tags for get and create results in the expected tags", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Create a counter with specific create tags
				const counter = await client.counter.get({
					tags: { id: "tag-test", env: "test" },
					create: { tags: { id: "tag-test", env: "test", version: "1.0" } },
				});
				await counter.increment(5);

				// Should match when searching with original search tags
				const foundWithSearchTags = await client.counter.get({
					tags: { id: "tag-test", env: "test" },
				});
				const countWithSearchTags = await foundWithSearchTags.increment(0);
				expect(countWithSearchTags).toBe(5);

				// Should also match when searching with any subset of the create tags
				const foundWithExtraTags = await client.counter.get({
					tags: { id: "tag-test", version: "1.0" },
				});
				const countWithExtraTags = await foundWithExtraTags.increment(0);
				expect(countWithExtraTags).toBe(5);

				// Create a new counter with just search tags but different create tags
				const newCounter = await client.counter.get({
					tags: { type: "secondary" },
					create: {
						tags: { type: "secondary", priority: "low", temp: "true" },
					},
				});
				await newCounter.increment(10);

				// Should not find when searching with tags not in create tags
				const notFound = await client.counter.get({
					tags: { type: "secondary", status: "active" },
				});
				const notFoundCount = await notFound.increment(0);
				expect(notFoundCount).toBe(0); // New counter
			});
		});

		describe("Multiple Actor Instances", () => {
			// TODO: This test is flakey https://github.com/rivet-gg/actor-core/issues/873
			//test("creates multiple actor instances of the same type", async () => {
			//	const { client } = await setupDriverTest<CounterApp>(
			//		driverTestConfig,
			//		resolve(__dirname, "../fixtures/apps/counter.ts"),
			//	);
			//
			//	// Create multiple instances with different IDs
			//	const instance1 = await client.counter.get({
			//		tags: { id: "multi-1" },
			//	});
			//	const instance2 = await client.counter.get({
			//		tags: { id: "multi-2" },
			//	});
			//	const instance3 = await client.counter.get({
			//		tags: { id: "multi-3" },
			//	});
			//
			//	// Set different states
			//	await instance1.increment(1);
			//	await instance2.increment(2);
			//	await instance3.increment(3);
			//
			//	// Retrieve all instances again
			//	const retrieved1 = await client.counter.get({
			//		tags: { id: "multi-1" },
			//	});
			//	const retrieved2 = await client.counter.get({
			//		tags: { id: "multi-2" },
			//	});
			//	const retrieved3 = await client.counter.get({
			//		tags: { id: "multi-3" },
			//	});
			//
			//	// Verify separate state
			//	expect(await retrieved1.increment(0)).toBe(1);
			//	expect(await retrieved2.increment(0)).toBe(2);
			//	expect(await retrieved3.increment(0)).toBe(3);
			//});

			test("handles default instance with no explicit ID", async () => {
				const { client } = await setupDriverTest<CounterApp>(
					driverTestConfig,
					resolve(__dirname, "../fixtures/apps/counter.ts"),
				);

				// Get default instance (no ID specified)
				const defaultCounter = await client.counter.get();

				// Set state
				await defaultCounter.increment(5);

				// Get default instance again
				const sameDefaultCounter = await client.counter.get();

				// Verify state is maintained
				const count = await sameDefaultCounter.increment(0);
				expect(count).toBe(5);
			});
		});
	});
}
