/// <reference types="node" />
import { createClient } from "@rivetkit/actor/client";
import type { Registry } from "../src/registry";

async function main() {
	const client = createClient<Registry>(
		process.env.ENDPOINT ?? "http://127.0.0.1:8080",
	);

	const contacts = client.contacts.getOrCreate();

	// counter.on("newCount", (count: number) => console.log("Event:", count));

	for (let i = 0; i < 5; i++) {
		const out = await contacts.insert({
			name: `User ${i}`,
			age: 20 + i,
			email: `example+${i}@example.com`,
		});
		console.log("Inserted:", out);
	}

	console.log("Reading all users:");
	const users = await contacts.read();
	console.log(users);

	// await counter.dispose();
}

main();
