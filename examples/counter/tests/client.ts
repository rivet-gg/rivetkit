/// <reference types="node" />
import { Client } from "actor-core/client";
import type Counter from "../src/counter.ts";

async function main() {
	const client = new Client(`http://localhost:${process.env.PORT ?? 8787}`);

	const counter = await client.get<Counter>({ name: "counter" });

	counter.on("newCount", (count: number) => console.log("Event:", count));

	for (let i = 0; i < 5; i++) {
		const out = await counter.increment(5);
		console.log("RPC:", out);

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	await counter.disconnect();
}

main();
