import { actor } from "@rivetkit/worker";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { getWeather } from "./my-utils";

export type Message = { role: "user" | "assistant"; content: string; timestamp: number; }

const aiAgent = actor({
  // State is automatically persisted
  state: { 
    messages: [] as Message[]
  },

  actions: {
    // Get conversation history
    getMessages: (c) => c.state.messages,

    // Send a message to the AI and get a response
    sendMessage: async (c, userMessage: string) => {
      // Add user message to conversation
      const userMsg: Message = { 
        role: "user", 
        content: userMessage,
        timestamp: Date.now()
      };
      c.state.messages.push(userMsg);
      
      // Generate AI response using Vercel AI SDK with tools
      const { text } = await generateText({
        model: openai("o3-mini"),
        prompt: userMessage,
        messages: c.state.messages,
        tools: {
          weather: tool({
            description: 'Get the weather in a location',
            parameters: {
              location: {
                type: 'string',
                description: 'The location to get the weather for',
              },
            },
            execute: async ({ location }) => {
              return await getWeather(location);
            },
          }),
        },
      });
      
      // Add AI response to conversation
      const assistantMsg: Message = { 
        role: "assistant", 
        content: text, 
        timestamp: Date.now() 
      };
      c.state.messages.push(assistantMsg);
      
      // Broadcast the new message to all connected clients
      c.broadcast("messageReceived", assistantMsg);
      
      return assistantMsg;
    },
  }
});

export default aiAgent;
