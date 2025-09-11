import { resolve } from "node:path";
import { type TestContext, vi } from "vitest";
import { assertUnreachable } from "@/actor/utils";
import { createClientWithDriver } from "@/client/client";
import { type Client, createClient } from "@/client/mod";
import type { registry } from "../../fixtures/driver-test-suite/registry";
import type { DriverTestConfig } from "./mod";
import { createTestInlineClientDriver } from "./test-inline-client-driver";

export const FAKE_TIME = new Date("2024-01-01T00:00:00.000Z");

// Must use `TestContext` since global hooks do not work when running concurrently
export async function setupDriverTest(
	c: TestContext,
	driverTestConfig: DriverTestConfig,
): Promise<{
	client: Client<typeof registry>;
	endpoint: string;
}> {
	if (!driverTestConfig.useRealTimers) {
		vi.useFakeTimers();
		vi.setSystemTime(FAKE_TIME);
	}

	// Build drivers
	const projectPath = resolve(__dirname, "../../fixtures/driver-test-suite");
	const { endpoint, cleanup } = await driverTestConfig.start(projectPath);
	c.onTestFinished(cleanup);

	let client: Client<typeof registry>;
	if (driverTestConfig.clientType === "http") {
		// Create client
		client = createClient<typeof registry>(endpoint, {
			transport: driverTestConfig.transport,
		});
	} else if (driverTestConfig.clientType === "inline") {
		// Use inline client from driver
		const clientDriver = createTestInlineClientDriver(
			endpoint,
			driverTestConfig.transport ?? "websocket",
		);
		client = createClientWithDriver(clientDriver);
	} else {
		assertUnreachable(driverTestConfig.clientType);
	}

	// Cleanup client
	if (!driverTestConfig.HACK_skipCleanupNet) {
		c.onTestFinished(async () => await client.dispose());
	}

	return {
		client,
		endpoint,
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
