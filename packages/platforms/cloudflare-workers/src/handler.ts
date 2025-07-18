import { AsyncLocalStorage } from "node:async_hooks";
import type { Registry, RunConfig } from "@rivetkit/core";
import type { Client } from "@rivetkit/core/client";
import { PartitionTopologyManager } from "@rivetkit/core/topologies/partition";
import { Hono } from "hono";
import invariant from "invariant";
import {
	type ActorHandlerInterface,
	createActorDurableObject,
	type DurableObjectConstructor,
} from "./actor-handler-do";
import { ConfigSchema, type InputConfig } from "./config";
import { CloudflareActorsManagerDriver } from "./manager-driver";
import { upgradeWebSocket } from "./websocket";

/** Cloudflare Workers env */
export interface Bindings {
	ACTOR_KV: KVNamespace;
	ACTOR_DO: DurableObjectNamespace<ActorHandlerInterface>;
}

/**
 * Stores the env for the current request. Required since some contexts like the inline client driver does not have access to the Hono context.
 *
 * Use getCloudflareAmbientEnv unless using CF_AMBIENT_ENV.run.
 */
export const CF_AMBIENT_ENV = new AsyncLocalStorage<Bindings>();

export function getCloudflareAmbientEnv(): Bindings {
	const env = CF_AMBIENT_ENV.getStore();
	invariant(env, "missing CF_AMBIENT_ENV");
	return env;
}

interface Handler {
	handler: ExportedHandler<Bindings>;
	ActorHandler: DurableObjectConstructor;
}

interface SetupOutput<A extends Registry<any>> {
	client: Client<A>;
	createHandler: (hono?: Hono) => Handler;
}

export function createServerHandler<R extends Registry<any>>(
	registry: R,
	inputConfig?: InputConfig,
): Handler {
	const { createHandler } = createServer(registry, inputConfig);
	return createHandler();
}

export function createServer<R extends Registry<any>>(
	registry: R,
	inputConfig?: InputConfig,
): SetupOutput<R> {
	const config = ConfigSchema.parse(inputConfig);

	// Create config
	const runConfig = {
		driver: {
			topology: "partition",
			manager: new CloudflareActorsManagerDriver(),
			// HACK: We can't build the actor driver until we're inside the Druable Object
			actor: undefined as any,
		},
		getUpgradeWebSocket: () => upgradeWebSocket,
		...config,
	} satisfies RunConfig;

	// Create Durable Object
	const ActorHandler = createActorDurableObject(registry, runConfig);

	const managerTopology = new PartitionTopologyManager(
		registry.config,
		runConfig,
	);

	return {
		client: managerTopology.inlineClient as Client<R>,
		createHandler: (hono) => {
			// Build base router
			const app = hono ?? new Hono();

			// Mount registry
			app.route("/registry", managerTopology.router);

			// Create Cloudflare handler
			const handler = {
				fetch: (request, env, ctx) => {
					return CF_AMBIENT_ENV.run(env, () => app.fetch(request, env, ctx));
				},
			} satisfies ExportedHandler<Bindings>;

			return { handler, ActorHandler };
		},
	};
}
