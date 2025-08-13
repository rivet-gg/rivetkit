import { env } from "cloudflare:workers";
import type { Registry, RunConfig } from "@rivetkit/core";
import type { Client } from "@rivetkit/core/client";
import { Hono } from "hono";
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
export function getCloudflareAmbientEnv(): Bindings {
	return env as unknown as Bindings;
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
			name: "cloudflare-workers",
			manager: () => new CloudflareActorsManagerDriver(),
			// HACK: We can't build the actor driver until we're inside the Durable Object
			actor: undefined as any,
		},
		getUpgradeWebSocket: () => upgradeWebSocket,
		...config,
	} satisfies RunConfig;

	// Create Durable Object
	const ActorHandler = createActorDurableObject(registry, runConfig);

	// Create server
	const serverOutput = registry.createServer(runConfig);

	return {
		client: serverOutput.client as Client<R>,
		createHandler: (hono) => {
			// Build base router
			const app = hono ?? new Hono();

			// Mount registry router at /registry
			if (!hono) {
				app.route("/registry", serverOutput.hono);
			}

			// Create Cloudflare handler
			const handler = {
				fetch: (request, env, ctx) => {
					return app.fetch(request, env, ctx);
				},
			} satisfies ExportedHandler<Bindings>;

			return { handler, ActorHandler };
		},
	};
}
