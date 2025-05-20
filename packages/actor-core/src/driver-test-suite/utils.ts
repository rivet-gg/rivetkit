import type { ActorCoreApp } from "@/mod";
import { type TestContext, vi } from "vitest";
import { createClient, type Client } from "@/client/mod";
import type { DriverTestConfig,  } from "./mod";

// Must use `TestContext` since global hooks do not work when running concurrently
export async function setupDriverTest<A extends ActorCoreApp<any>>(
	c: TestContext,
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

export async function waitFor(
	driverTestConfig: DriverTestConfig,
	ms: number,
): Promise<void> {
	if (driverTestConfig.useRealTimers) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	} else {
		vi.advanceTimersByTime(ms);
		return Promise.resolve();
	}
}
