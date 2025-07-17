import { createClient } from "@rivetkit/actor/client";
import type { registry } from "../src/registry";

// Create RivetKit client
const client = createClient<typeof registry>(
	process.env.RIVETKIT_ENDPOINT ?? "http://localhost:8787",
);

async function main() {
	console.log("🚀 Cloudflare Workers Client Demo");

	try {
		// // Create counter instance
		// const counter = client.counter.getOrCreate("demo");
		// const conn = counter.connect();
		// conn.on("foo", (x) => console.log("output", x));
		//
		// // Increment counter
		// console.log("Incrementing counter 'demo'...");
		// const result1 = await counter.increment(1);
		// console.log("New count:", result1);
		//
		// // Increment again with larger value
		// console.log("Incrementing counter 'demo' by 5...");
		// const result2 = await counter.increment(5);
		// console.log("New count:", result2);
		//
		// // Create another counter
		// const counter2 = client.counter.getOrCreate("another");
		// console.log("Incrementing counter 'another' by 10...");
		// const result3 = await counter2.increment(10);
		// console.log("New count:", result3);
		//
		// console.log("✅ Demo completed!");

		const ws = await client.counter.getOrCreate("demo").websocket();

		console.log("point 1");
		await new Promise<void>((resolve) => {
			ws.addEventListener("open", () => resolve(), { once: true });
		});

		console.log("point 2");
		// Skip welcome message
		await new Promise<void>((resolve) => {
			ws.addEventListener("message", () => resolve(), { once: true });
		});
		console.log("point 3");

		// Send and receive echo
		const testMessage = { test: "data", timestamp: Date.now() };
		ws.send(JSON.stringify(testMessage));
		console.log("point 4");

		const echoMessage = await new Promise<any>((resolve) => {
			ws.addEventListener(
				"message",
				(event: any) => {
					resolve(JSON.parse(event.data as string));
				},
				{ once: true },
			);
		});
		console.log("point 3");

		ws.close();
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	}
}

main().catch(console.error);
