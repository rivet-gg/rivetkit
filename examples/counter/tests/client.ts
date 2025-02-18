import { Client } from "actor-core/client";
import type Counter from "../src/counter.ts";

async function main() {
	const client = new Client(`http://localhost:${process.env.PORT ?? 8787}`);
	//const client = new Client(
	//	"https://ae306cfd-da45-4a99-910a-8445bac7ac8a-http.actor.6510ffa2-a144-4110-928c-f14b562326b4.rivet.run:443",
	//);

	const counter = await client.get<Counter>({ name: "counter" });

	counter.on("newCount", (count: number) => console.log("Event:", count));

	//for (let i = 0; i < 5; i++) {
	while (true) {
		const out = await counter.increment(5);
		console.log("RPC:", out);

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	await counter.disconnect();
}

main();
