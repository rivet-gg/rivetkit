import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployToRivet } from "./rivet-deploy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple counter actor definition to deploy
const COUNTER_ACTOR = `
import { actor, setup } from "actor-core";

const counter = actor({
  state: { count: 0 },
  actions: {
    increment: (c, amount) => {
      c.state.count += amount;
      c.broadcast("newCount", c.state.count);
      return c.state.count;
    },
    getCount: (c) => {
      return c.state.count;
    },
  },
});

export const app = setup({
  actors: { counter },
});

export type App = typeof app;
`;

test("Rivet deployment tests", async () => {
	// Create a temporary path for the counter actor
	const tempFilePath = path.join(
		__dirname,
		"../../../..",
		"target",
		"temp-counter-app.ts",
	);

	// Ensure target directory exists
	await fs.mkdir(path.dirname(tempFilePath), { recursive: true });

	// Write the counter actor file
	await fs.writeFile(tempFilePath, COUNTER_ACTOR);

	// Run the deployment
	const result = await deployToRivet(tempFilePath, true);
});
