import { join } from "node:path";
import {
	createTestRuntime,
	runDriverTests,
} from "@rivetkit/core/driver-test-suite";
import { createRedisDriver } from "../src/mod";

runDriverTests({
	// Causes odd connectoin issues when disabled
	useRealTimers: true,
	async start(appPath: string) {
		return await createTestRuntime(
			join(appPath, "registry.ts"),
			async (registry) => {
				// Get the pre-started container port from environment
				const port = parseInt(process.env.VALKEY_TEST_PORT!);
				if (!port) {
					throw new Error("VALKEY_TEST_PORT not set. Ensure global setup ran.");
				}

				// Create driver config
				const driverConfig = createRedisDriver({
					host: "localhost",
					port,
					// Isolate namespace for each test
					keyPrefix: `test-${crypto.randomUUID()}:`,
				});

				return {
					driver: driverConfig,
				};
			},
		);
	},
});
