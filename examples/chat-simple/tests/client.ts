import { Client } from "actor-core/client";
import { setupLogging } from "actor-core/log";
import type ChatRoom from "../src/chat-room.ts";

async function main() {
	setupLogging();

	const client = new Client("http://localhost:8787", {
		transport: "sse",
		encoding: "json",
	});
	//const client = new Client(
	//	"http://127.0.0.1:7080/47c74e23-ecb1-4070-809b-86ad4bf260f3-http",
	//);

	// connect to chat room
	const chatRoom = await client.get<ChatRoom>({ name: "chat-room" });

	// call rpc to get existing messages
	const messages = await chatRoom.getMessages();
	console.log("Messages:", messages);

	// listen for new messages
	chatRoom.on("newMessage", (username: string, message: string) =>
		console.log(`Message from ${username}: ${message}`),
	);

	// send message to room
	await chatRoom.sendMessage("william", "All the world's a stage.");

	// disconnect from actor when finished
	await chatRoom.disconnect();
}

main();
