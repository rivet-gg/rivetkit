import { getPort } from "@rivetkit/core/test";
import Redis from "ioredis";
import { $ } from "zx";

interface ContainerInfo {
	port: number;
	containerId: string;
}

// Global promise to ensure only one container is started
let containerPromise: Promise<ContainerInfo> | null = null;

export async function getOrStartValkeyContainer(): Promise<ContainerInfo> {
	// If container is already being started or has been started, return that promise
	if (containerPromise) {
		return containerPromise;
	}

	// Start a new container
	containerPromise = startValkeyContainer();
	return containerPromise;
}

async function startValkeyContainer(): Promise<ContainerInfo> {
	const containerName = `valkey-test-shared`;

	// Check if container is already running
	try {
		const existingContainer =
			await $`docker ps -a -q -f name=^${containerName}$`.quiet();
		if (existingContainer.stdout.trim()) {
			// Check if it's actually running
			const runningContainer =
				await $`docker ps -q -f name=^${containerName}$`.quiet();
			if (runningContainer.stdout.trim()) {
				// Container is running, get its port
				const portInfo = await $`docker port ${containerName} 6379`.quiet();
				const port = parseInt(portInfo.stdout.split(":")[1]);
				console.log(`Using existing Valkey container on port ${port}`);
				return { port, containerId: existingContainer.stdout.trim() };
			} else {
				// Container exists but is stopped, remove it
				console.log(`Removing stopped container ${containerName}`);
				await $`docker rm ${containerName}`.quiet();
			}
		}
	} catch {
		// Container doesn't exist, continue to create new one
	}

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

	console.log(`Started new Valkey container on port ${port}`);

	return { port, containerId };
}

export async function stopValkeyContainer(containerId: string): Promise<void> {
	await $`docker stop ${containerId}`;
}
