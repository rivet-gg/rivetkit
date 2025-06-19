import { Client, ClientDriver, createClientWithDriver } from "@/client/client";
import {
	type RegistryWorkers,
	type RegistryConfig,
	type RegistryConfigInput,
	RegistryConfigSchema,
} from "./config";
import {
	RunConfigSchema,
	type DriverConfig,
	type RunConfig,
	type RunConfigInput,
} from "./run-config";
import { StandaloneTopology } from "@/topologies/standalone/mod";
import invariant from "invariant";
import type { Hono } from "hono";
import { assertUnreachable } from "@/utils";

interface RunOutput<A extends Registry<any>> {
	client: Client<A>;
	hono: Hono;
	handler: (req: Request) => Promise<Response>;
}

export class Registry<A extends RegistryWorkers> {
	#config: RegistryConfig;

	public get config(): RegistryConfig {
		return this.#config;
	}

	constructor(config: RegistryConfig) {
		this.#config = config;
	}

	public run(inputConfig: RunConfigInput): RunOutput<this> {
		const config = RunConfigSchema.parse(inputConfig);

		// Setup topology
		let hono: Hono;
		let clientDriver: ClientDriver;
		if (config.driver.topology === "standalone") {
			const topology = new StandaloneTopology(this.#config, config);
			hono = topology.router;
			clientDriver = topology.clientDriver;
		} else if (config.driver.topology === "partition") {
			// TODO:
			invariant(false, "foo");
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
		};
	}

	// public runAndServe(): RunOutput<this> {
	// 	// TODO:
	// }
}

export function setup<A extends RegistryWorkers>(
	input: RegistryConfigInput<A>,
): Registry<A> {
	const config = RegistryConfigSchema.parse(input);
	return new Registry(config);
}

export type { RegistryConfig, RegistryWorkers, RunConfig, DriverConfig };
export { RegistryConfigSchema };
