import { setup } from "rivetkit";
import dotenv from "dotenv";
import { codingAgent } from "./coding-agent/mod";

// Load environment variables from .env file
dotenv.config();

// Create and export the app
export const registry = setup({
	workers: { codingAgent },
});

// Export type for client type checking
export type Registry = typeof registry;
