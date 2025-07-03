import { createClient } from "@rivetkit/actor/client";
import { registry } from "../src/registry";

const client = createClient<typeof registry>("http://localhost:8088");

async function main() {
	console.log("Redis Example Client");
	console.log("===================");

	// Create a counter actor
	const counter = client.counter.getOrCreate("my-counter");

	// Get initial count
	const initialCount = await counter.getCount();
	console.log(`Initial count: ${initialCount}`);

	// Increment the counter
	console.log("Incrementing by 5...");
	const newCount = await counter.increment(5);
	console.log(`New count: ${newCount}`);

	// Increment again
	console.log("Incrementing by 3...");
	const finalCount = await counter.increment(3);
	console.log(`Final count: ${finalCount}`);

	// Reset the counter
	console.log("Resetting counter...");
	const resetCount = await counter.reset();
	console.log(`Reset count: ${resetCount}`);

	// Create another counter to demonstrate persistence
	const counter2 = client.counter.getOrCreate("another-counter");
	console.log("Incrementing second counter by 10...");
	const count2 = await counter2.increment(10);
	console.log(`Second counter: ${count2}`);

	console.log("\nDemo complete! The counter state is persisted in Redis.");
	console.log("You can restart the server and the state will be preserved.");
}

main().catch(console.error);