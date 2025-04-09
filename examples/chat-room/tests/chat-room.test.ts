import { test, expect } from "vitest";
import { setupTest } from "actor-core/test";
import { app } from "../actors/app";

test("chat room should handle messages", async (test) => {
	const { client } = await setupTest(test, app);

	// Connect to chat room
	const chatRoom = await client.chatRoom.get();

	// Initial history should be empty
	const initialMessages = await chatRoom.getHistory();
	expect(initialMessages).toEqual([]);

	// Test event emission
	let receivedUsername = "";
	let receivedMessage = "";
	chatRoom.on("newMessage", (username: string, message: string) => {
		receivedUsername = username;
		receivedMessage = message;
	});

	// Send a message
	const testUser = "william";
	const testMessage = "All the world's a stage.";
	await chatRoom.sendMessage(testUser, testMessage);

	// Verify event was emitted with correct data
	expect(receivedUsername).toBe(testUser);
	expect(receivedMessage).toBe(testMessage);

	// Verify message was stored in history
	const updatedMessages = await chatRoom.getHistory();
	expect(updatedMessages).toEqual([
		{ username: testUser, message: testMessage },
	]);

	// Send multiple messages and verify
	const users = ["romeo", "juliet", "othello"];
	const messages = [
		"Wherefore art thou?",
		"Here I am!",
		"The green-eyed monster.",
	];

	for (let i = 0; i < users.length; i++) {
		await chatRoom.sendMessage(users[i], messages[i]);

		// Verify event emission
		expect(receivedUsername).toBe(users[i]);
		expect(receivedMessage).toBe(messages[i]);
	}

	// Verify all messages are in history in correct order
	const finalHistory = await chatRoom.getHistory();
	expect(finalHistory).toEqual([
		{ username: testUser, message: testMessage },
		...users.map((username, i) => ({ username, message: messages[i] })),
	]);
});
