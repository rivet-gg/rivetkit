import { join } from "node:path";
import {
	createTestRuntime,
	runDriverTests,
} from "@rivetkit/core/driver-test-suite";
import { Redis } from "ioredis";
import { createRedisDriver } from "../src/mod";

runDriverTests({
	// Causes odd connectoin issues when disabled
	useRealTimers: true,
	skip: {
		// Scheduling is not supported
		schedule: true,
	},
	async start(appPath: string) {
		return await createTestRuntime(
			join(appPath, "registry.ts"),
			async (registry) => {
				// Get the pre-started container port from environment
				const port = parseInt(process.env.VALKEY_TEST_PORT!);
				if (!port) {
					throw new Error("VALKEY_TEST_PORT not set. Ensure global setup ran.");
				}

				// Create driver config with explicit Redis instance
				const driverConfig = createRedisDriver({
					redis: new Redis({
						host: "localhost",
						port,
					}),
					// Isolate namespace for each test
					keyPrefix: `test-${crypto.randomUUID()}`,
				});

				return {
					driver: driverConfig,
				};
			},
		);
	},
});
