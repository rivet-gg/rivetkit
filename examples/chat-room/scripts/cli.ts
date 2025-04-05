import { createClient, type Encoding } from "actor-core/client";
import type { App } from "../src/app";
import prompts from "prompts";

async function main() {
	const { encoding, username, room } = await initPrompt();

	// Create type-aware client
	const client = createClient<App>("http://localhost:6420", {
		encoding,
	});

	// connect to chat room - now accessed via property
	// can still pass parameters like room
	const chatRoom = await client.chatRoom.get({
		params: { room },
	});

	// fetch history
	const history = await chatRoom.getHistory();
	console.log(
		`History:\n${history.map((m) => `[${m.username}] ${m.message}`).join("\n")}`,
	);

	// listen for new messages
	//
	// `needsNewLine` is a hack to work around console.log clobbering prompts
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

	await chatRoom.dispose();
}

async function initPrompt(): Promise<{
	encoding: Encoding;
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
