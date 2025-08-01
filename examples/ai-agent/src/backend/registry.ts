import { openai } from "@ai-sdk/openai";
import { actor, setup } from "@rivetkit/actor";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { getWeather } from "./utils";

export type Message = {
	role: "user" | "assistant";
	content: string;
};

export const aiAgent = actor({
	onAuth: () => {},
	// Persistent state that survives restarts: https://rivet.gg/docs/actors/state
	state: {
		messages: [] as Message[],
	},

	actions: {
		// Callable functions from clients: https://rivet.gg/docs/actors/actions
		getMessages: (c) => c.state.messages,

		sendMessage: async (c, userMessage: string) => {
			const userMsg: Message = {
				role: "user",
				content: userMessage,
			};
			// State changes are automatically persisted
			c.state.messages.push(userMsg);

			// Only keep recent messages to avoid token limits
			const recentMessages = c.state.messages.slice(-10); // Keep last 10 messages

			const result = await generateText({
				model: openai("gpt-4o-mini"),
				messages: recentMessages,
				tools: {
					weather: tool({
						description: "Get the weather in a location",
						inputSchema: z.object({
							location: z
								.string()
								.describe("The location to get the weather for"),
						}),
						execute: async ({ location }) => {
							return await getWeather(location);
						},
					}),
				},
				stopWhen: stepCountIs(5), // Allow multiple steps for tool use and response generation
			});

			const assistantMsg: Message = {
				role: "assistant",
				content:
					result.text || "I apologize, but I couldn't generate a response.",
			};
			c.state.messages.push(assistantMsg);

			// Send events to all connected clients: https://rivet.gg/docs/actors/events
			c.broadcast("messageReceived", assistantMsg);

			return assistantMsg;
		},
	},
});

// Register actors for use: https://rivet.gg/docs/setup
export const registry = setup({
	use: { aiAgent },
});
