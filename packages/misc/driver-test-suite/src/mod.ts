import { serve as honoServe } from "@hono/node-server";
import {
	ActorDriver,
	CoordinateDriver,
	DriverConfig,
	ManagerDriver,
} from "actor-core/driver-helpers";
import { runActorDriverTests, waitFor } from "./tests/actor-driver";
import { runManagerDriverTests } from "./tests/manager-driver";
import { describe } from "vitest";
import {
	type ActorCoreApp,
	CoordinateTopology,
	StandaloneTopology,
} from "actor-core";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import invariant from "invariant";
import { bundleRequire } from "bundle-require";
import { getPort } from "actor-core/test";

export interface DriverTestConfig {
	/** Deploys an app and returns the connection endpoint. */
	start(appPath: string): Promise<DriverDeployOutput>;

	/**
	 * If we're testing with an external system, we should use real timers
	 * instead of Vitest's mocked timers.
	 **/
	useRealTimers?: boolean;

	/** Cloudflare Workers has some bugs with cleanup. */
	HACK_skipCleanupNet?: boolean;
}

export interface DriverDeployOutput {
	endpoint: string;

	/** Cleans up the test. */
	cleanup(): Promise<void>;
}

/** Runs all Vitest tests against the provided drivers. */
export function runDriverTests(driverTestConfig: DriverTestConfig) {
	describe("driver tests", () => {
		runActorDriverTests(driverTestConfig);
		runManagerDriverTests(driverTestConfig);
	});
}

/**
 * Re-export the waitFor helper for use in other tests.
 * This function handles waiting in tests, using either real timers or mocked timers
 * based on the driverTestConfig.useRealTimers setting.
 */
export { waitFor };

/**
 * Helper function to adapt the drivers to the Node.js runtime for tests.
 *
 * This is helpful for drivers that run in-process as opposed to drivers that rely on external tools.
 */
export async function createTestRuntime(
	appPath: string,
	driverFactory: (app: ActorCoreApp<any>) => Promise<{
		actorDriver: ActorDriver;
		managerDriver: ManagerDriver;
		coordinateDriver?: CoordinateDriver;
		cleanup?: () => Promise<void>;
	}>,
): Promise<DriverDeployOutput> {
	const {
		mod: { app },
	} = await bundleRequire({
		filepath: appPath,
	});

	// Build drivers
	const {
		actorDriver,
		managerDriver,
		coordinateDriver,
		cleanup: driverCleanup,
	} = await driverFactory(app);

	// Build driver config
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	const config: DriverConfig = {
		drivers: {
			actor: actorDriver,
			manager: managerDriver,
			coordinate: coordinateDriver,
		},
		getUpgradeWebSocket: (app) => {
			const webSocket = createNodeWebSocket({ app });
			injectWebSocket = webSocket.injectWebSocket;
			return webSocket.upgradeWebSocket;
		},
	};

	// Build topology
	const topology = coordinateDriver
		? new CoordinateTopology(app.config, config)
		: new StandaloneTopology(app.config, config);
	if (!injectWebSocket) throw new Error("injectWebSocket not defined");

	// Start server
	const port = await getPort();
	const server = honoServe({
		fetch: topology.router.fetch,
		hostname: "127.0.0.1",
		port,
	});
	invariant(injectWebSocket !== undefined, "should have injectWebSocket");
	injectWebSocket(server);

	// Cleanup
	const cleanup = async () => {
		// Stop server
		await new Promise((resolve) => server.close(() => resolve(undefined)));

		// Extra cleanup
		await driverCleanup?.();
	};

	return { endpoint: `http://127.0.0.1:${port}`, cleanup };
}
