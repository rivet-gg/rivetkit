process.env._LOG_LEVEL="DEBUG";
import {
	runDriverTests,
	createTestRuntime,
} from "@actor-core/driver-test-suite";
import { RedisActorDriver, RedisCoordinateDriver, RedisManagerDriver } from "../src/mod";
import Redis from "ioredis";
import { promisify } from "node:util";
import { exec as execCallback } from "node:child_process";
import { expect, test } from "vitest";
import { getPort } from "actor-core/test";

const exec = promisify(execCallback);

async function startValkeyContainer(): Promise<{
	port: number;
	containerId: string;
}> {
	const containerName = `valkey-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
	const port = await getPort();

	const { stdout } = await exec(
		`docker run --rm -d --name ${containerName} -p ${port}:6379 valkey/valkey:latest`,
	);
	const containerId = stdout.trim();

	// Wait for the port to be available using a simple TCP probe
	const maxRetries = 10;
	const retryDelayMs = 100;
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Use a simple command to check if the port is open
			await exec(`nc -z localhost ${port}`);
			// Port is available, container is ready
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

	return { port, containerId };
}

async function stopValkeyContainer(containerId: string): Promise<void> {
	try {
		await exec(`docker stop ${containerId}`);
	} catch (error) {
		throw new Error(`Failed to stop container ${containerId}: ${error}`);
	}
}

runDriverTests({
	// Causes odd connectoin issues when disabled
	useRealTimers: true,
	async start(appPath: string) {
		return await createTestRuntime(appPath, async (app) => {
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
				actorDriver: new RedisActorDriver(redisClient),
				managerDriver: new RedisManagerDriver(redisClient, app),
				coordinateDriver: new RedisCoordinateDriver(redisClient),
				async cleanup() {
					// TODO: This causes an error
					//await redisClient.quit();
					await stopValkeyContainer(containerId);
				},
			};
		});
	},
});

// Test to verify that the Docker container management works correctly
test("Valkey container starts and stops properly", async () => {
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
		await newRedis.connect();
		await newRedis.quit();
		throw new Error("Valkey connection should have failed");
	} catch (error) {
		// Expected to fail since the container should be stopped
		expect(error).toBeDefined();
	}
});
