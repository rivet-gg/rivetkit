import { type ViteUserConfig } from "vitest/config";

export default {
	test: {
		// Enable parallelism
		sequence: {
			concurrent: true,
		},
		// Increase timeout for proxy tests
		testTimeout: 15_000,
		env: {
			// Enable logging
			_LOG_LEVEL: "DEBUG",
			_ACTOR_CORE_ERROR_STACK: "1"
		}
	},
} satisfies ViteUserConfig;
