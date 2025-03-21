//import { actor, setup } from "actor-core";
//import { test } from "vitest";
//import { setupTest } from "./test-utils";
//
//test("basic actor setup", async () => {
//	const counter = actor({
//		state: { count: 0 },
//		actions: {
//			increment: (c, x: number) => {
//				c.state.count += x;
//				c.broadcast("newCount", c.state.count);
//				return c.state.count;
//			},
//		},
//	});
//
//	const app = setup({
//		actors: { counter },
//	});
//
//	const { client } = await setupTest<typeof app>(app);
//
//	const counterInstance = await client.counter.get();
//	await counterInstance.increment(1);
//});
//
