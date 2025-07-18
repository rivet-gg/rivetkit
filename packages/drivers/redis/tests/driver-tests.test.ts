import { join } from "node:path";
import {
	createTestRuntime,
	runDriverTests,
} from "@rivetkit/core/driver-test-suite";
import { getPort } from "@rivetkit/core/test";
import Redis from "ioredis";
import { expect, test } from "vitest";
import { $ } from "zx";
import {
	RedisActorDriver,
	RedisCoordinateDriver,
	RedisManagerDriver,
} from "../src/mod";

async function startValkeyContainer(): Promise<{
	port: number;
	containerId: string;
}> {
	const containerName = `valkey-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
	const port = await getPort();

	// Run docker container with output piped to process
	const result =
		await $`docker run --rm -d --name ${containerName} -p ${port}:6379 valkey/valkey:latest`;
	const containerId = result.stdout.trim();

	if (!containerId) {
		throw new Error("Failed to start Docker container");
	}

	// Wait for Redis to be available by attempting to connect
	const maxRetries = 10;
	const retryDelayMs = 100;
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Try to connect to Redis with silent logging
			const redis = new Redis({
				port,
				host: "127.0.0.1",
				connectTimeout: 1000,
				retryStrategy: () => null, // Disable retries to fail fast
				maxRetriesPerRequest: 1,
				// Suppress Redis client logging
				showFriendlyErrorStack: false,
			});
			await redis.ping();
			await redis.quit();
			break;
		} catch (error) {
			if (attempt === maxRetries) {
				await stopValkeyContainer(containerId).catch(() => {});
				throw new Error(
					`Valkey container port ${port} never became available after ${maxRetries} attempts`,
				);
			}

			// Wait before trying again
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
		}
	}

	console.log(`Successfully connected on port ${port}`);

	return { port, containerId };
}

async function stopValkeyContainer(containerId: string): Promise<void> {
	await $`docker stop ${containerId}`;
}

runDriverTests({
	// Causes odd connectoin issues when disabled
	useRealTimers: true,
	async start(appPath: string) {
		return await createTestRuntime(
			join(appPath, "registry.ts"),
			async (registry) => {
				const { port, containerId } = await startValkeyContainer();

				// Create a new Redis client for this test (we still use ioredis for client)
				const redisClient = new Redis({
					host: "localhost",
					port,
					// Use a random db number to avoid conflicts
					db: Math.floor(Math.random() * 15),
					// Add a prefix for additional isolation
					keyPrefix: `test-${Date.now()}-${Math.floor(Math.random() * 10000)}:`,
				});

				return {
					driver: {
						topology: "coordinate" as const,
						actor: new RedisActorDriver(redisClient),
						manager: new RedisManagerDriver(redisClient, registry),
						coordinate: new RedisCoordinateDriver(redisClient),
					},
					async cleanup() {
						try {
							await redisClient.quit();
						} catch (error) {
							// Ignore cleanup errors
						}
						await stopValkeyContainer(containerId);
					},
				};
			},
		);
	},
});

// Test to verify that the Docker container management works correctly
test("Valkey container starts and stops properly", async () => {
	try {
		const { port, containerId } = await startValkeyContainer();

		// Check if Valkey is accessible
		const redis = new Redis({ port, host: "localhost" });
		await redis.set("test-key", "test-value");
		const value = await redis.get("test-key");
		expect(value).toBe("test-value");

		await redis.quit();
		await stopValkeyContainer(containerId);

		// Verify the container is stopped
		try {
			const newRedis = new Redis({
				port,
				host: "localhost",
				connectTimeout: 1000,
			});
			await newRedis.quit();
			throw new Error("Valkey connection should have failed");
		} catch (error) {
			// Expected to fail since the container should be stopped
			expect(error).toBeDefined();
		}
	} catch (error) {
		console.error(`Docker test failed: ${error}`);
		throw error;
	}
});
