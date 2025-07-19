import Redis from "ioredis";
import { expect, test } from "vitest";

test("shared Valkey container works correctly", async () => {
	console.log("Testing pre-started Valkey container...");

	// Get the pre-started container info from environment
	const port = parseInt(process.env.VALKEY_TEST_PORT!);
	const containerId = process.env.VALKEY_TEST_CONTAINER_ID!;

	expect(port).toBeTruthy();
	expect(containerId).toBeTruthy();

	console.log(
		`Using pre-started container ID: ${containerId} on port: ${port}`,
	);

	// Verify we can connect and use Redis with isolated key prefix
	const keyPrefix = `test-container-setup-${Date.now()}:`;
	const redis = new Redis({ port, host: "127.0.0.1", keyPrefix });
	await redis.set("test-key", "test-value");
	const value = await redis.get("test-key");
	expect(value).toBe("test-value");
	console.log(`Redis test successful: ${value}`);

	await redis.quit();

	console.log("Container test completed successfully");
});
