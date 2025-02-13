import { Client, type Encoding, type Transport } from "actor-core/client";
import type ChatRoom from "../src/chat-room";
import prompts from "prompts";

async function main() {
	const { encoding, transport, username, room } = await initPrompt();
	const client = new Client("http://localhost:8787", {
		encoding,
		transport,
	});

	// connect to chat room
	const chatRoom = await client.get<ChatRoom>({
		name: "chat-room",
		room,
	});

	// fetch history
	const history = await chatRoom.getHistory();
	console.log(
		`History:\n${history.map((m) => `[${m.username}] ${m.message}`).join("\n")}`,
	);

	// listen for new messages
	//
	// `needsNewLine` is a hack to work aroudn console.log clobbering prompts
	let needsNewLine = false;
	chatRoom.on("newMessage", (username: string, message: string) => {
		if (needsNewLine) {
			needsNewLine = false;
			console.log();
		}
		console.log(`[${username}] ${message}`);
	});

	// loop to send messages
	while (true) {
		needsNewLine = true;
		const message = await textPrompt("Message");
		if (!message) break;
		needsNewLine = false;
		await chatRoom.sendMessage(username, message);
	}

	await chatRoom.disconnect();
}

async function initPrompt(): Promise<{
	encoding: Encoding;
	transport: Transport;
	room: string;
	username: string;
}> {
	return await prompts([
		{
			type: "select",
			name: "encoding",
			message: "Encoding",
			choices: [
				{ title: "CBOR", value: "cbor" },
				{ title: "JSON", value: "json" },
			],
		},
		{
			type: "select",
			name: "transport",
			message: "Transport",
			choices: [
				{ title: "WebSocket", value: "websocket" },
				{ title: "Server Sent Events", value: "sse" },
			],
		},
		{
			type: "text",
			name: "username",
			message: "Username",
		},
		{
			type: "text",
			name: "room",
			message: "Room",
		},
	]);
}

async function textPrompt(message: string): Promise<string> {
	const { x } = await prompts({
		type: "text",
		name: "x",
		message,
	});
	return x;
}

main();
