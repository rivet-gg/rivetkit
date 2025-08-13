import type { Hono } from "hono";
import { createActorRouter } from "@/actor/router";
import { type Client, createClientWithDriver } from "@/client/client";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import { getStudioUrl } from "@/inspector/utils";
import { createManagerRouter } from "@/manager/router";
import {
	type RegistryActors,
	type RegistryConfig,
	type RegistryConfigInput,
	RegistryConfigSchema,
} from "./config";
import { logger } from "./log";
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
	hono: Hono<any>;
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
		let upgradeWebSocket: any;
		if (!config.getUpgradeWebSocket) {
			config.getUpgradeWebSocket = () => upgradeWebSocket!;
		}

		// Create router
		const managerDriver = config.driver.manager(this.#config, config);
		const clientDriver = createInlineClientDriver(managerDriver);
		const { router: hono } = createManagerRouter(
			this.#config,
			config,
			clientDriver,
			managerDriver,
			false,
		);

		// Create client
		const client = createClientWithDriver<this>(clientDriver);

		const driverLog = managerDriver.extraStartupLog?.() ?? {};
		logger().info("rivetkit ready", {
			driver: config.driver.name,
			definitions: Object.keys(this.#config.use).length,
			...driverLog,
		});
		if (config.studio?.enabled) {
			logger().info("studio ready", {
				url: getStudioUrl(config),
			});
		}

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
		let upgradeWebSocket: any;
		if (!config.getUpgradeWebSocket) {
			config.getUpgradeWebSocket = () => upgradeWebSocket!;
		}

		// Create router
		const managerDriver = config.driver.manager(this.#config, config);
		const inlineClient = createClientWithDriver(
			createInlineClientDriver(managerDriver),
		);
		const actorDriver = config.driver.actor(
			this.#config,
			config,
			managerDriver,
			inlineClient,
		);
		const hono = createActorRouter(config, actorDriver);

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
