import { type ViteUserConfig } from "vitest/config";

export default {
	test: {
		// Enable parallelism
		sequence: {
			concurrent: true,
		},
		env: {
			// Enable logging
			_LOG_LEVEL: "DEBUG",
			_ACTOR_CORE_ERROR_STACK: "1"
		}
	},
} satisfies ViteUserConfig;
