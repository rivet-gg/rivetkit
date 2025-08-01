import { setupTest } from "@rivetkit/actor/test";
import { expect, test, vi } from "vitest";
import { registry } from "../src/backend/registry";

// Mock the AI SDK and OpenAI
vi.mock("@ai-sdk/openai", () => ({
	openai: () => "mock-model",
}));

vi.mock("ai", () => ({
	streamText: vi.fn().mockImplementation(() => ({
		fullStream: {
			[Symbol.asyncIterator]: async function* () {
				yield { type: "text-delta", text: "AI response to: " };
				yield { type: "text-delta", text: "Hello, how are you?" };
			},
		},
		text: Promise.resolve("AI response to: Hello, how are you?"),
		toolCalls: Promise.resolve([]),
		toolResults: Promise.resolve([]),
	})),
	tool: vi.fn().mockImplementation(({ execute }) => ({ execute })),
}));

vi.mock("../src/backend/utils", () => ({
	getWeather: vi
		.fn()
		.mockResolvedValue(
			"The weather in San Francisco is currently sunny with a temperature of 72°C and humidity at 45%.",
		),
}));

test("AI Agent can handle basic actions without connection", async (ctx) => {
	const { client } = await setupTest(ctx, registry);
	const agent = client.aiAgent.getOrCreate(["test-basic"]);

	// Test initial state
	const initialMessages = await agent.getMessages();
	expect(initialMessages).toEqual([]);

	// Send a message
	const userMessage = "Hello, how are you?";
	const response = await agent.sendMessage(userMessage);

	// Verify response structure
	expect(response).toMatchObject({
		role: "assistant",
		content: expect.stringContaining("AI response to: Hello, how are you?"),
	});

	// Verify messages are stored
	const messages = await agent.getMessages();
	expect(messages).toHaveLength(2);
	expect(messages[0]).toMatchObject({
		role: "user",
		content: userMessage,
	});
	expect(messages[1]).toEqual(response);
});

test("AI Agent maintains conversation history", async (ctx) => {
	const { client } = await setupTest(ctx, registry);
	const agent = client.aiAgent.getOrCreate(["test-history"]);

	// Send multiple messages
	await agent.sendMessage("First message");
	await agent.sendMessage("Second message");
	await agent.sendMessage("Third message");

	const messages = await agent.getMessages();
	expect(messages).toHaveLength(6); // 3 user + 3 assistant messages

	// Verify message ordering and roles
	expect(messages[0].role).toBe("user");
	expect(messages[0].content).toBe("First message");
	expect(messages[1].role).toBe("assistant");
	expect(messages[2].role).toBe("user");
	expect(messages[2].content).toBe("Second message");
	expect(messages[3].role).toBe("assistant");
	expect(messages[4].role).toBe("user");
	expect(messages[4].content).toBe("Third message");
	expect(messages[5].role).toBe("assistant");
});

test("AI Agent handles weather tool usage", async (ctx) => {
	const { client } = await setupTest(ctx, registry);
	const agent = client.aiAgent.getOrCreate(["test-weather"]);

	// Send a weather-related message
	const response = await agent.sendMessage(
		"What's the weather in San Francisco?",
	);

	// Verify response was generated
	expect(response.role).toBe("assistant");
	expect(response.content).toContain(
		"AI response to: What's the weather in San Francisco?",
	);

	// Verify message history includes both user and assistant messages
	const messages = await agent.getMessages();
	expect(messages).toHaveLength(2);
	expect(messages[0].content).toBe("What's the weather in San Francisco?");
	expect(messages[1]).toEqual(response);
});
