import { actor, setup } from "@/mod";
import { describe, test, expect, vi } from "vitest";
import { setupTest } from "@/test/mod";

describe("Actor Vars", () => {
	describe("Static vars", () => {
		test("should provide access to static vars", async (c) => {
			// Define actor with static vars
			const varActor = actor({
				state: { value: 0 },
				connState: { hello: "world" },
				vars: { counter: 42, name: "test-actor" },
				actions: {
					getVars: (c) => {
						return c.vars;
					},
					getName: (c) => {
						return c.vars.name;
					},
				},
			});

			const app = setup({
				actors: { varActor },
			});

			const { client } = await setupTest<typeof app>(c, app);
			const instance = await client.varActor.connect();

			// Test accessing vars
			const result = await instance.getVars();
			expect(result).toEqual({ counter: 42, name: "test-actor" });

			// Test accessing specific var property
			const name = await instance.getName();
			expect(name).toBe("test-actor");
		});
	});

	describe("Deep cloning of static vars", () => {
		test("should deep clone static vars between actor instances", async (c) => {
			// Define actor with nested object in vars
			const nestedVarActor = actor({
				state: { value: 0 },
				connState: { hello: "world" },
				vars: {
					counter: 42,
					nested: {
						value: "original",
						array: [1, 2, 3],
						obj: { key: "value" },
					},
				},
				actions: {
					getVars: (c) => {
						return c.vars;
					},
					modifyNested: (c) => {
						// Attempt to modify the nested object
						c.vars.nested.value = "modified";
						c.vars.nested.array.push(4);
						c.vars.nested.obj.key = "new-value";
						return c.vars;
					},
				},
			});

			const app = setup({
				actors: { nestedVarActor },
			});

			const { client } = await setupTest<typeof app>(c, app);

			// Create two separate instances
			const instance1 = await client.nestedVarActor.connect(
				{ id: "instance1" }
			);
			const instance2 = await client.nestedVarActor.connect(
				{ id: "instance2" }
			);

			// Modify vars in the first instance
			const modifiedVars = await instance1.modifyNested();
			expect(modifiedVars.nested.value).toBe("modified");
			expect(modifiedVars.nested.array).toContain(4);
			expect(modifiedVars.nested.obj.key).toBe("new-value");

			// Check that the second instance still has the original values
			const instance2Vars = await instance2.getVars();
			expect(instance2Vars.nested.value).toBe("original");
			expect(instance2Vars.nested.array).toEqual([1, 2, 3]);
			expect(instance2Vars.nested.obj.key).toBe("value");
		});
	});

	describe("createVars", () => {
		test("should support dynamic vars creation", async (c) => {
			// Define actor with createVars function
			const dynamicVarActor = actor({
				state: { value: 0 },
				connState: { hello: "world" },
				createVars: () => {
					return {
						random: Math.random(),
						computed: `Actor-${Math.floor(Math.random() * 1000)}`,
					};
				},
				actions: {
					getVars: (c) => {
						return c.vars;
					},
				},
			});

			const app = setup({
				actors: { dynamicVarActor },
			});

			const { client } = await setupTest<typeof app>(c, app);

			// Create an instance
			const instance = await client.dynamicVarActor.connect();

			// Test accessing dynamically created vars
			const vars = await instance.getVars();
			expect(vars).toHaveProperty("random");
			expect(vars).toHaveProperty("computed");
			expect(typeof vars.random).toBe("number");
			expect(typeof vars.computed).toBe("string");
			expect(vars.computed).toMatch(/^Actor-\d+$/);
		});

		test("should create different vars for different instances", async (c) => {
			// Define actor with createVars function that generates unique values
			const uniqueVarActor = actor({
				state: { value: 0 },
				connState: { hello: "world" },
				createVars: () => {
					return {
						id: Math.floor(Math.random() * 1000000),
					};
				},
				actions: {
					getVars: (c) => {
						return c.vars;
					},
				},
			});

			const app = setup({
				actors: { uniqueVarActor },
			});

			const { client } = await setupTest<typeof app>(c, app);

			// Create two separate instances
			const instance1 = await client.uniqueVarActor.connect(
				{ id: "test1" }
			);
			const instance2 = await client.uniqueVarActor.connect(
				{ id: "test2" }
			);

			// Get vars from both instances
			const vars1 = await instance1.getVars();
			const vars2 = await instance2.getVars();

			// Verify they have different values
			expect(vars1.id).not.toBe(vars2.id);
		});
	});

	describe("Driver Context", () => {
		test("should provide access to driver context", async (c) => {
			// Reset timers to avoid test timeouts
			vi.useRealTimers();

			// Define actor with createVars that uses driver context
			interface DriverVars {
				hasDriverCtx: boolean;
			}

			const driverCtxActor = actor({
				state: { value: 0 },
				connState: { hello: "world" },
				createVars: (c, driverCtx: any): DriverVars => {
					// In test environment, we get a context with a state property
					return {
						hasDriverCtx: driverCtx?.isTest,
					};
				},
				actions: {
					getVars: (c) => {
						return c.vars as DriverVars;
					},
				},
			});

			const app = setup({
				actors: { driverCtxActor },
			});

			// Set up the test
			const { client } = await setupTest<typeof app>(c, app);

			// Create an instance
			const instance = await client.driverCtxActor.connect();

			// Test accessing driver context through vars
			const vars = await instance.getVars();

			// Verify we can access driver context
			expect(vars.hasDriverCtx).toBe(true);
		});
	});
});
