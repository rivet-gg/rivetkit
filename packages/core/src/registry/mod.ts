import {
	type Client,
	type ClientDriver,
	createClientWithDriver,
} from "@/client/client";
import { PartitionTopologyActor, PartitionTopologyManager } from "@/mod";
import { StandaloneTopology } from "@/topologies/standalone/mod";
import { assertUnreachable } from "@/utils";
import type { Hono } from "hono";
import invariant from "invariant";
import {
	type RegistryActors,
	type RegistryConfig,
	type RegistryConfigInput,
	RegistryConfigSchema,
} from "./config";
import {
	type DriverConfig,
	type RunConfig,
	type RunConfigInput,
	RunConfigSchema,
} from "./run-config";
import { crossPlatformServe } from "./serve";

interface ServerOutput<A extends Registry<any>> {
	client: Client<A>;
	hono: Hono;
	handler: (req: Request) => Promise<Response>;
	serve: (hono?: Hono) => void;
}

interface ActorNodeOutput {
	hono: Hono;
	handler: (req: Request) => Promise<Response>;
	serve: (hono?: Hono) => void;
}

export class Registry<A extends RegistryActors> {
	#config: RegistryConfig;

	public get config(): RegistryConfig {
		return this.#config;
	}

	constructor(config: RegistryConfig) {
		this.#config = config;
	}

	/**
	 * Runs the registry for a server.
	 */
	public createServer(inputConfig?: RunConfigInput): ServerOutput<this> {
		const config = RunConfigSchema.parse(inputConfig);

		// Configure getUpgradeWebSocket lazily so we can assign it in crossPlatformServe
		let upgradeWebSocket = undefined;
		if (!config.getUpgradeWebSocket) {
			config.getUpgradeWebSocket = () => upgradeWebSocket!;
		}

		// Setup topology
		let hono: Hono;
		let clientDriver: ClientDriver;
		if (config.driver.topology === "standalone") {
			const topology = new StandaloneTopology(this.#config, config);
			hono = topology.router;
			clientDriver = topology.clientDriver;
		} else if (config.driver.topology === "partition") {
			const topology = new PartitionTopologyManager(this.#config, config);
			hono = topology.router;
			clientDriver = topology.clientDriver;
		} else if (config.driver.topology === "coordinate") {
			const topology = new StandaloneTopology(this.#config, config);
			hono = topology.router;
			clientDriver = topology.clientDriver;
		} else {
			assertUnreachable(config.driver.topology);
		}

		// Create client
		const client = createClientWithDriver<this>(clientDriver);

		return {
			client,
			hono,
			handler: async (req: Request) => await hono.fetch(req),
			serve: async (app) => {
				const out = await crossPlatformServe(hono, app);
				upgradeWebSocket = out.upgradeWebSocket;
			},
		};
	}

	/**
	 * Runs the registry as a standalone server.
	 */
	public async runServer(inputConfig?: RunConfigInput) {
		const { serve } = this.createServer(inputConfig);
		serve();
	}

	/**
	 * Creates a worker for the registry.
	 */
	public createWorker(inputConfig?: RunConfigInput): ActorNodeOutput {
		const config = RunConfigSchema.parse(inputConfig);

		// Configure getUpgradeWebSocket lazily so we can assign it in crossPlatformServe
		let upgradeWebSocket = undefined;
		if (!config.getUpgradeWebSocket) {
			config.getUpgradeWebSocket = () => upgradeWebSocket!;
		}

		// Setup topology
		let hono: Hono;
		if (config.driver.topology === "standalone") {
			invariant(false, "cannot run actor node for standalone topology");
		} else if (config.driver.topology === "partition") {
			const topology = new PartitionTopologyActor(this.#config, config);
			hono = topology.router;
		} else if (config.driver.topology === "coordinate") {
			invariant(false, "cannot run actor node for coordinate topology");
		} else {
			assertUnreachable(config.driver.topology);
		}

		return {
			hono,
			handler: async (req: Request) => await hono.fetch(req),
			serve: async (app) => {
				const out = await crossPlatformServe(hono, app);
				upgradeWebSocket = out.upgradeWebSocket;
			},
		};
	}

	/**
	 * Runs the standalone worker.
	 */
	public async runWorker(inputConfig?: RunConfigInput) {
		const { serve } = this.createWorker(inputConfig);
		serve();
	}
}

export function setup<A extends RegistryActors>(
	input: RegistryConfigInput<A>,
): Registry<A> {
	const config = RegistryConfigSchema.parse(input);
	return new Registry(config);
}

export type { RegistryConfig, RegistryActors, RunConfig, DriverConfig };
export { RegistryConfigSchema };
