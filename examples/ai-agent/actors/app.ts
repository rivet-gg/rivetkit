import { actor, setup } from "actor-core";
import { generateText, jsonSchema, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { getWeather } from "../utils/weather";
import dotenv from "dotenv";

dotenv.config();

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
      const out = await generateText({
        model: openai("o3-mini"),
        messages: c.state.messages,
        tools: {
          weather: tool({
            description: 'Get the weather in a location',
            parameters: jsonSchema<{ coords: { longitude: number, latitude: number } }>({
              type: 'object',
              properties: {
                coords: {
                  type: 'object',
                  description: 'The location to get the weather for',
                  properties: {
                    longitude: {
                      type: 'number',
                      description: 'Longitude of the location'
                    },
                    latitude: {
                      type: 'number',
                      description: 'Latitude of the location'
                    }
                  },
                  required: ['longitude', 'latitude'],
                  additionalProperties: false
                }
              },
              required: ['coords'],
              additionalProperties: false
            }),
            execute: async ({ coords }) => {
              return await getWeather(coords);
            }
          }),
        },
        maxSteps: 2,
      });

      const { text } = out;
      
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

// Create and export the app
export const app = setup({
  actors: { aiAgent },
});

// Export type for client type checking
export type App = typeof app; 