import { actor, setup } from "@/mod";
import { test, expect } from "vitest";
import { setupTest } from "@/test/mod";

test("basic actor setup", async (c) => {
	const counter = actor({
		state: { count: 0 },
		actions: {
			increment: (c, x: number) => {
				c.state.count += x;
				c.broadcast("newCount", c.state.count);
				return c.state.count;
			},
		},
	});

	const app = setup({
		actors: { counter },
	});

	const { client } = await setupTest<typeof app>(c, app);

	const counterInstance = client.counter.getOrCreate();
	await counterInstance.increment(1);
});

test("actorhandle.resolve resolves actor ID", async (c) => {
	const testActor = actor({
		state: { value: "" },
		actions: {
			getValue: (c) => c.state.value,
		},
	});

	const app = setup({
		actors: { testActor },
	});

	const { client } = await setupTest<typeof app>(c, app);

	// Get a handle to the actor using a key
	const handle = client.testActor.getOrCreate("test-key");
	
	// Resolve should work without errors and return void
	await handle.resolve();
	
	// After resolving, we should be able to call an action
	const value = await handle.getValue();
	expect(value).toBeDefined();
});

test("client.create creates a new actor", async (c) => {
	const testActor = actor({
		state: { createdVia: "" },
		actions: {
			setCreationMethod: (c, method: string) => {
				c.state.createdVia = method;
				return c.state.createdVia;
			},
			getCreationMethod: (c) => c.state.createdVia,
		},
	});

	const app = setup({
		actors: { testActor },
	});

	const { client } = await setupTest<typeof app>(c, app);

	// Create a new actor using client.create
	const handle = await client.testActor.create("created-actor");
	
	// Set some state to confirm it works
	const result = await handle.setCreationMethod("client.create");
	expect(result).toBe("client.create");
	
	// Verify we can retrieve the state
	const method = await handle.getCreationMethod();
	expect(method).toBe("client.create");
});
