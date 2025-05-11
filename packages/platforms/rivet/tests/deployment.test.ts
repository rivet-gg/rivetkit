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

describe.skip("Rivet deployment tests", () => {
	let tmpDir: string;
	let cleanup: () => Promise<void>;

	// Set up test environment before all tests
	beforeAll(async () => {
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
		const result = await deployToRivet(tempFilePath);
		tmpDir = result.tmpDir;
		cleanup = result.cleanup;
	});

	// Clean up after all tests
	afterAll(async () => {
		if (cleanup) {
			await cleanup();
		}
	});

	test("deploys counter actor to Rivet and retrieves endpoint", async () => {
		// This test just verifies that the deployment was successful
		// The actual deployment work is done in the beforeAll hook
		expect(tmpDir).toBeTruthy();
	}, 180000); // Increased timeout to 3 minutes for the full deployment
});
