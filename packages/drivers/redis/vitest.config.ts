import defaultConfig from "../../../vitest.base.ts";
import { defineConfig } from "vitest/config";

export default defineConfig({
	...defaultConfig,
	test: {
		...defaultConfig.test,
		// Requires time for downloading container
		testTimeout: 60_000,
	}
});
