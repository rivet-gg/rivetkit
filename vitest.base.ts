import { type ViteUserConfig } from "vitest/config";

export default {
	test: {
		// Enable parallelism
		sequence: {
			concurrent: true,
		},
		// Increase timeout
		testTimeout: 5_000,
		env: {
			// Enable loggin
			_LOG_LEVEL: "DEBUG"
		}
	},
} satisfies ViteUserConfig;
