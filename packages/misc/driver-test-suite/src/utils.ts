import type { ActorCoreApp } from "actor-core";
import { type TestContext, vi } from "vitest";
import { createClient, Transport, type Client } from "actor-core/client";
import type { DriverTestConfig, DriverTestConfigWithTransport } from "./mod";

// Must use `TestContext` since global hooks do not work when running concurrently
export async function setupDriverTest<A extends ActorCoreApp<any>>(
	c: TestContext,
	driverTestConfig: DriverTestConfigWithTransport,
	appPath: string,
): Promise<{
	client: Client<A>;
}> {
	if (!driverTestConfig.useRealTimers) {
		vi.useFakeTimers();
	}

	// Build drivers
	const { endpoint, cleanup } = await driverTestConfig.start(appPath);
	c.onTestFinished(cleanup);

	// Create client
	const client = createClient<A>(endpoint, {
		transport: driverTestConfig.transport,
	});
	if (!driverTestConfig.HACK_skipCleanupNet) {
		c.onTestFinished(async () => await client.dispose());
	}

	return {
		client,
	};
}
