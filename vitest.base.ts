import { type ViteUserConfig } from "vitest/config";

export default {
	test: {
		// Enable parallelism
		sequence: {
			concurrent: true,
		},
		// Increase timeout
		testTimeout: 30_000,
	},
} satisfies ViteUserConfig;
