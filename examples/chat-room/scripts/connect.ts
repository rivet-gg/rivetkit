/// <reference types="node" />
import { createClient } from "@rivetkit/actor/client";
import type { Registry } from "../actors/registry";

async function main() {
	// Create type-aware client
	const client = createClient<Registry>(process.env.ENDPOINT ?? "http://localhost:8080");

	// connect to chat room - now accessed via property
	const chatRoom = client.chatRoom.getOrCreate().connect();

	// call action to get existing messages
	const messages = await chatRoom.getHistory();
	console.log("Messages:", messages);

	// listen for new messages
	chatRoom.on("newMessage", (username: string, message: string) =>
		console.log(`Message from ${username}: ${message}`),
	);

	// send message to room
	await chatRoom.sendMessage("william", "All the world's a stage.");

	// disconnect from actor when finished
	await chatRoom.dispose();
}

main();
