import { Client } from "actor-core/client";
import type Counter from "../src/counter.ts";

async function main() {
	const client = new Client(`http://localhost:${process.env.PORT ?? 8787}`, {
		transport: "websocket",
		encoding: "json",
	});
	// const client = new Client("https://fcfc69c5-c0a5-4f46-8fdf-2156c21187b3-http.actor.6510ffa2-a144-4110-928c-f14b562326b4.rivet.run:443", {
	// 	transport: "sse",
	// 	encoding: "json"
	// });

	const counter = await client.get<Counter>({ name: "counter" });

	counter.on("newCount", (count: number) => console.log("Event:", count));

	//for (let i = 0; i < 5; i++) {
	while (true) {
		const out = await counter.increment(5);
		console.log("RPC:", out);

		await new Promise(resolve => setTimeout(resolve, 1000));
	}

	await counter.disconnect();
}

main();
