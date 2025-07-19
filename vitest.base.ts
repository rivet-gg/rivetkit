import type { ViteUserConfig } from "vitest/config";

export default {
	test: {
		testTimeout: 2_000,
		hookTimeout: 2_000,
		// Enable parallelism
		sequence: {
			// TODO: This breaks fake timers, unsure how to make tests run in parallel within the same file
			// concurrent: true,
		},
		env: {
			// Enable logging
			_LOG_LEVEL: "DEBUG",
			_RIVETKIT_ERROR_STACK: "1",
		},
	},
} satisfies ViteUserConfig;
