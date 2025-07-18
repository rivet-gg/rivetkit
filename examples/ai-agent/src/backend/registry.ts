import { openai } from "@ai-sdk/openai";
import { actor, setup } from "@rivetkit/actor";
import { generateText, tool } from "ai";
import { z } from "zod";
import { getWeather } from "./my-utils";

export type Message = {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
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
				timestamp: Date.now(),
			};
			// State changes are automatically persisted
			c.state.messages.push(userMsg);

			const { text } = await generateText({
				model: openai("gpt-4o-mini"),
				prompt: userMessage,
				messages: c.state.messages,
				tools: {
					weather: tool({
						description: "Get the weather in a location",
						parameters: z.object({
							location: z
								.string()
								.describe("The location to get the weather for"),
						}),
						execute: async ({ location }) => {
							return await getWeather(location);
						},
					}),
				},
			});

			const assistantMsg: Message = {
				role: "assistant",
				content: text,
				timestamp: Date.now(),
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
