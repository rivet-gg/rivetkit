import type { ActorCoreApp } from "actor-core";
import { onTestFinished, vi } from "vitest";
import { createClient, type Client } from "actor-core/client";
import type { DriverTestConfig } from "./mod";

export async function setupDriverTest<A extends ActorCoreApp<any>>(
	driverTestConfig: DriverTestConfig,
	appPath: string,
): Promise<{
	client: Client<A>;
}> {
	if (!driverTestConfig.useRealTimers) {
		vi.useFakeTimers();
	}

	// Build drivers
	const { endpoint, cleanup } = await driverTestConfig.start(appPath);
	onTestFinished(async () => cleanup());

	// Create client
	const client = createClient<A>(endpoint);
	if (!driverTestConfig.HACK_skipCleanupNet) {
		onTestFinished(async () => await client.dispose());
	}

	return {
		client,
	};
}
