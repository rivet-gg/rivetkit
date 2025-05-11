import { actor, setup } from "@/mod";
import { test } from "vitest";
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

	const counterInstance = client.counter.connect();
	await counterInstance.increment(1);
});
