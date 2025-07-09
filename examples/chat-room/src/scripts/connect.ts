/// <reference types="node" />
import { createClient } from "@rivetkit/actor/client";
import type { registry } from "../backend/registry";

async function main() {
	// Create type-aware client
	const client = createClient<typeof registry>(
		process.env.ENDPOINT ?? "http://localhost:8080",
	);

	// connect to chat room
	const chatRoom = client.chatRoom.getOrCreate().connect();

	// call action to get existing messages
	const messages = await chatRoom.getHistory();
	console.log("Messages:", messages);

	// listen for new messages
	chatRoom.on("newMessage", (message: any) =>
		console.log(`Message from ${message.sender}: ${message.text}`),
	);

	// send message to room
	await chatRoom.sendMessage("william", "All the world's a stage.");

	// disconnect from actor when finished
	await chatRoom.dispose();
}

main();
