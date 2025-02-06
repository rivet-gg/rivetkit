import { Client } from "actor-core/client";
import type Counter from "../src/counter.ts";

async function main() {
	const client = new Client("http://localhost:8787", {
		transport: "sse",
		encoding: "json",
	});
	//const client = new Client("https://b96e97d1-6ea0-48f6-ad55-c44a1e985346-http.actor.6510ffa2-a144-4110-928c-f14b562326b4.rivet.run:443");

	const counter = await client.get<Counter>({ name: "counter" });

	counter.on("newCount", (count: number) => console.log("Event:", count));

	for (let i = 0; i < 5; i++) {
		const out = await counter.increment(5);
		console.log("RPC:", out);

		await new Promise(resolve => setTimeout(resolve, 1000));
	}

	await counter.disconnect();
}

main();
