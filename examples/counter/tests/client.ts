/// <reference types="node" />
import { createClient } from "actor-core/client";
import type { App } from "../src/index";
import type counterDef from "../src/counter";

async function main() {
	const client = createClient<App>(process.env.ENDPOINT ?? `http://localhost:6420`);

	const counter = await client.counter.get()
	//const counter = await client.get<typeof counterDef>({ name: "counter" });

	//const counter = await client.get<Counter>({ name: "counter" });

	counter.on("newCount", (count: number) => console.log("Event:", count));

	for (let i = 0; i < 5; i++) {
		const out = await counter.increment(5);
		console.log("RPC:", out);

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	await counter.dispose();
}

main();
