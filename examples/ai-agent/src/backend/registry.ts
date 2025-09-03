import { openai } from "@ai-sdk/openai";
import { actor, setup } from "@rivetkit/actor";
import { logger } from "@rivetkit/actor/log";
import { type CoreMessage, streamText, tool } from "ai";
import { z } from "zod";
import { getWeather } from "./utils";

// Export for frontend - using AI SDK's CoreMessage type
export type Message = CoreMessage;

export const aiAgent = actor({
	onAuth: () => {},
	state: {
		messages: [] as CoreMessage[],
	},

	actions: {
		getMessages: (c) => c.state.messages,

		sendMessage: async (c, userMessage: string) => {
			// Add user message to state
			const userMsg: CoreMessage = {
				role: "user",
				content: userMessage,
			};
			c.state.messages.push(userMsg);

			try {
				// Destructure streams directly from streamText
				const { fullStream, text, toolResults } = streamText({
					model: openai("gpt-4o"),
					messages: c.state.messages,
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
					maxSteps: 5, // Allow multiple steps for tool use and response generation
				});

				let assistantContent = "";

				// Process the full stream to handle both text and tool calls
				for await (const chunk of fullStream) {
					// Handle text streaming - the property is 'text' not 'textDelta'
					if (chunk.type === "text-delta") {
						assistantContent += chunk.text;
						// Broadcast text updates
						c.broadcast("messageUpdate", {
							role: "assistant",
							content: assistantContent,
						} as CoreMessage);
					}
					// AI generates text after tools execute
				}

				// After streaming is complete, get the final text
				const finalText = await text;

				// Ensure we have a response
				if (!finalText) {
					// If no text was generated but tools were called, use tool output
					const toolResultsData = await toolResults;
					if (toolResultsData && toolResultsData.length > 0) {
						const toolOutput = toolResultsData[0].output;
						assistantContent =
							typeof toolOutput === "string"
								? toolOutput
								: JSON.stringify(toolOutput);
					}
				} else {
					assistantContent = finalText;
				}

				// Save and broadcast final message
				if (assistantContent) {
					const assistantMsg: CoreMessage = {
						role: "assistant",
						content: assistantContent,
					};
					c.state.messages.push(assistantMsg);
					c.broadcast("messageReceived", assistantMsg);
					return assistantMsg;
				} else {
					throw new Error("No response generated from AI");
				}
			} catch (error) {
				logger().error("error in sendMessage", { error });

				const errorContent =
					error instanceof Error
						? `Sorry, an error occurred: ${error.message}`
						: "Sorry, I encountered an error processing your message.";

				const errorMsg: CoreMessage = {
					role: "assistant",
					content: errorContent,
				};

				c.state.messages.push(errorMsg);
				c.broadcast("messageReceived", errorMsg);
				return errorMsg;
			}
		},
	},
});

// Register actors for use: https://rivet.gg/docs/setup
export const registry = setup({
	use: { aiAgent },
});
