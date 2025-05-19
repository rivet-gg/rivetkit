import { actor, setup } from "@/mod";
import { describe, test, expect, vi } from "vitest";
import { setupTest } from "@/test/mod";
import { createHash } from "crypto";

describe("ActorHandle", () => {
	test("basic handle operations", async (c) => {
		// Create a simple counter actor
		const counter = actor({
			state: { count: 0 },
			actions: {
				increment: (c, x: number) => {
					c.state.count += x;
					return c.state.count;
				},
				getCount: (c) => {
					return c.state.count;
				},
			},
		});

		const app = setup({
			actors: { counter },
		});

		const { client } = await setupTest<typeof app>(c, app);

		// Test get (getOrCreate behavior)
		const counterHandle = client.counter.get("test-counter");
		expect(counterHandle).toBeDefined();

		const count = await counterHandle.increment(1);
		expect(count).toBe(1);
	});

	test("get with noCreate option", async (c) => {
		const counter = actor({
			state: { count: 0 },
			actions: {
				increment: (c, x: number) => {
					c.state.count += x;
					return c.state.count;
				},
			},
		});

		const app = setup({
			actors: { counter },
		});

		const { client } = await setupTest<typeof app>(c, app);

		// Test handles can be created
		const counterHandle1 = client.counter.get("test-counter-nocreate");
		expect(counterHandle1).toBeDefined();

		const counterHandle2 = client.counter.get("test-counter-nocreate", {
			noCreate: true,
		});
		expect(counterHandle2).toBeDefined();
	});

	test("create and getForId", async (c) => {
		const counter = actor({
			state: { count: 0 },
			actions: {
				increment: (c, x: number) => {
					c.state.count += x;
					return c.state.count;
				},
				getCount: (c) => {
					return c.state.count;
				},
				getActorId: (c) => {
					return c.actorId;
				},
			},
		});

		const app = setup({
			actors: { counter },
		});

		const { client } = await setupTest<typeof app>(c, app);

		// Check that handles can be created
		const createdHandle = client.counter.create("test-counter-create");
		await createdHandle.increment(10);
		const actorId = await createdHandle.getActorId();

		// Get the same actor by ID
		const idHandle = client.counter.getForId(actorId);
		const count = await idHandle.getCount();
		expect(count).toBe(10);
	});

	test("handles are stateless but access the same actor", async (c) => {
		const counter = actor({
			state: { count: 0 },
			actions: {
				increment: (c, x: number) => {
					c.state.count += x;
					return c.state.count;
				},
				getCount: (c) => {
					return c.state.count;
				},
			},
		});

		const app = setup({
			actors: { counter },
		});

		const { client } = await setupTest<typeof app>(c, app);

		// Create handles
		const handle1 = client.counter.get("test-stateless");

		const handle2 = client.counter.get("test-stateless");

		await handle1.increment(1);
		await handle2.increment(2);

		// Both handles access the same actor state
		const count = await handle1.getCount();
		expect(count).toBe(3);
	});
});
