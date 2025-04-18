import { setup } from "actor-core";
import dotenv from "dotenv";
import { codingAgent } from "./coding-agent/mod";

// Load environment variables from .env file
dotenv.config();

// Create and export the app
export const app = setup({
	actors: { codingAgent },
});

// Export type for client type checking
export type App = typeof app;
