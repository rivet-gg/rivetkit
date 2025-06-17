import { serve as honoServe } from "@hono/node-server";
import {
	WorkerDriver,
	CoordinateDriver,
	DriverConfig,
	ManagerDriver,
} from "@/driver-helpers/mod";
import { runWorkerDriverTests } from "./tests/worker-driver";
import { runManagerDriverTests } from "./tests/manager-driver";
import { describe } from "vitest";
import { CoordinateTopology, StandaloneTopology, Registry } from "@/mod";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import invariant from "invariant";
import { bundleRequire } from "bundle-require";
import { getPort } from "@/test/mod";
import { Transport } from "@/client/mod";
import { runWorkerConnTests } from "./tests/worker-conn";
import { runWorkerHandleTests } from "./tests/worker-handle";
import { runActionFeaturesTests } from "./tests/action-features";
import { runWorkerVarsTests } from "./tests/worker-vars";
import { runWorkerConnStateTests } from "./tests/worker-conn-state";
import { runWorkerMetadataTests } from "./tests/worker-metadata";
import { runWorkerErrorHandlingTests } from "./tests/worker-error-handling";

export interface DriverTestConfig {
	/** Deploys an registry and returns the connection endpoint. */
	start(projectDir: string): Promise<DriverDeployOutput>;

	/**
	 * If we're testing with an external system, we should use real timers
	 * instead of Vitest's mocked timers.
	 **/
	useRealTimers?: boolean;

	/** Cloudflare Workers has some bugs with cleanup. */
	HACK_skipCleanupNet?: boolean;

	transport?: Transport;

	clientType: ClientType;
}

/**
 * The type of client to run the test with.
 *
 * The logic for HTTP vs inline is very different, so this helps validate all behavior matches.
 **/
type ClientType = "http" | "inline";

export interface DriverDeployOutput {
	endpoint: string;

	/** Cleans up the test. */
	cleanup(): Promise<void>;
}

/** Runs all Vitest tests against the provided drivers. */
export function runDriverTests(
	driverTestConfigPartial: Omit<DriverTestConfig, "clientType" | "transport">,
) {
	for (const clientType of ["http", "inline"] as ClientType[]) {
		const driverTestConfig: DriverTestConfig = {
			...driverTestConfigPartial,
			clientType,
		};

		describe(`client type (${clientType})`, () => {
			runWorkerDriverTests(driverTestConfig);
			runManagerDriverTests(driverTestConfig);

			// TODO: Add back SSE once fixed in Rivet driver & CF lifecycle
			// for (const transport of ["websocket", "sse"] as Transport[]) {
			for (const transport of ["websocket"] as Transport[]) {
				describe(`transport (${transport})`, () => {
					runWorkerConnTests({
						...driverTestConfig,
						transport,
					});

					runWorkerConnStateTests({ ...driverTestConfig, transport });
				});
			}

			runWorkerHandleTests(driverTestConfig);

			runActionFeaturesTests(driverTestConfig);

			runWorkerVarsTests(driverTestConfig);

			runWorkerMetadataTests(driverTestConfig);

			runWorkerErrorHandlingTests(driverTestConfig);
		});
	}
}

/**
 * Helper function to adapt the drivers to the Node.js runtime for tests.
 *
 * This is helpful for drivers that run in-process as opposed to drivers that rely on external tools.
 */
export async function createTestRuntime(
	registryPath: string,
	driverFactory: (registry: Registry<any>) => Promise<{
		workerDriver: WorkerDriver;
		managerDriver: ManagerDriver;
		coordinateDriver?: CoordinateDriver;
		cleanup?: () => Promise<void>;
	}>,
): Promise<DriverDeployOutput> {
	const {
		mod: { registry },
	} = await bundleRequire<{ registry: Registry<any> }>({
		filepath: registryPath,
	});

	// TODO: Find a cleaner way of flagging an registry as test mode (ideally not in the config itself)
	// Force enable test
	registry.config.test.enabled = true;

	// Build drivers
	const {
		workerDriver,
		managerDriver,
		coordinateDriver,
		cleanup: driverCleanup,
	} = await driverFactory(registry);

	// Build driver config
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	const config: DriverConfig = {
		drivers: {
			worker: workerDriver,
			manager: managerDriver,
			coordinate: coordinateDriver,
		},
		getUpgradeWebSocket: (router) => {
			const webSocket = createNodeWebSocket({ app: router });
			injectWebSocket = webSocket.injectWebSocket;
			return webSocket.upgradeWebSocket;
		},
	};

	// Build topology
	const topology = coordinateDriver
		? new CoordinateTopology(registry.config, config)
		: new StandaloneTopology(registry.config, config);
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
	const endpoint = `http://127.0.0.1:${port}`;

	// Cleanup
	const cleanup = async () => {
		// Stop server
		await new Promise((resolve) => server.close(() => resolve(undefined)));

		// Extra cleanup
		await driverCleanup?.();
	};

	return {
		endpoint,
		cleanup,
	};
}
