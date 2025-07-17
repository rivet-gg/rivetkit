import { serve as honoServe } from "@hono/node-server";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import { bundleRequire } from "bundle-require";
import invariant from "invariant";
import { describe } from "vitest";
import type { Transport } from "@/client/mod";
import {
	CoordinateTopology,
	type DriverConfig,
	type Registry,
	type RunConfig,
	StandaloneTopology,
} from "@/mod";
import { RunConfigSchema } from "@/registry/run-config";
import { getPort } from "@/test/mod";
import { runActionFeaturesTests } from "./tests/action-features";
import { runActorAuthTests } from "./tests/actor-auth";
import { runActorConnTests } from "./tests/actor-conn";
import { runActorConnStateTests } from "./tests/actor-conn-state";
import { runActorDriverTests } from "./tests/actor-driver";
import { runActorErrorHandlingTests } from "./tests/actor-error-handling";
import { runActorHandleTests } from "./tests/actor-handle";
import { runActorInlineClientTests } from "./tests/actor-inline-client";
import { runActorMetadataTests } from "./tests/actor-metadata";
import { runActorVarsTests } from "./tests/actor-vars";
import { runManagerDriverTests } from "./tests/manager-driver";
import { runRawHttpTests } from "./tests/raw-http";
import { runRawHttpDirectRegistryTests } from "./tests/raw-http-direct-registry";
import { runRawHttpRequestPropertiesTests } from "./tests/raw-http-request-properties";
import { runRawWebSocketTests } from "./tests/raw-websocket";
import { runRawWebSocketDirectRegistryTests } from "./tests/raw-websocket-direct-registry";

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
			runActorDriverTests(driverTestConfig);
			runManagerDriverTests(driverTestConfig);

			// TODO: Add back SSE once fixed in Rivet driver & CF lifecycle
			// for (const transport of ["websocket", "sse"] as Transport[]) {
			for (const transport of ["websocket"] as Transport[]) {
				describe(`transport (${transport})`, () => {
					runActorConnTests({
						...driverTestConfig,
						transport,
					});

					runActorConnStateTests({ ...driverTestConfig, transport });
				});
			}

			runActorHandleTests(driverTestConfig);

			runActionFeaturesTests(driverTestConfig);

			runActorVarsTests(driverTestConfig);

			runActorMetadataTests(driverTestConfig);

			runActorErrorHandlingTests(driverTestConfig);

			runActorAuthTests(driverTestConfig);

			runActorInlineClientTests(driverTestConfig);

			runRawHttpTests(driverTestConfig);

			runRawHttpRequestPropertiesTests(driverTestConfig);

			runRawWebSocketTests(driverTestConfig);

			runRawHttpDirectRegistryTests(driverTestConfig);

			runRawWebSocketDirectRegistryTests(driverTestConfig);
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
		driver: DriverConfig;
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
	const { driver, cleanup: driverCleanup } = await driverFactory(registry);

	// Build driver config
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	let upgradeWebSocket: any;
	const config: RunConfig = RunConfigSchema.parse({
		driver,
		getUpgradeWebSocket: () => upgradeWebSocket!,
	});

	// Build topology
	const topology =
		config.driver.topology === "coordinate"
			? new CoordinateTopology(registry.config, config)
			: new StandaloneTopology(registry.config, config);

	// Inject WebSocket
	const nodeWebSocket = createNodeWebSocket({ app: topology.router });
	upgradeWebSocket = nodeWebSocket.upgradeWebSocket;
	injectWebSocket = nodeWebSocket.injectWebSocket;

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
