import { setupLogging } from "@/common/log";
import { stringifyError } from "@/common/utils";
import type { Registry, RunConfig } from "@/registry/mod";
import { PartitionTopologyActor } from "@/topologies/partition/mod";
import type { ActorContext } from "@rivet-gg/actor-core";
import invariant from "invariant";
import { RivetActorDriver } from "./actor-driver";
import { type Config, ConfigSchema, type InputConfig } from "./config";
import { logger } from "./log";
import { RivetManagerDriver } from "./manager-driver";
import { type RivetClientConfig, getRivetClientConfig } from "./rivet-client";
import { type RivetHandler, deserializeKeyFromTag } from "./util";
import * as cbor from "cbor-x";

export function createActorHandler(
	registry: Registry<any>,
	inputConfig?: InputConfig,
): RivetHandler {
	let config: Config;
	try {
		config = ConfigSchema.parse(inputConfig);
	} catch (error) {
		logger().error("failed to start manager", { error: stringifyError(error) });
		Deno.exit(1);
	}

	return {
		async start(ctx: ActorContext) {
			const role = ctx.metadata.actor.tags.role;
			if (role === "actor") {
				await startActor(ctx, registry, config);
			} else {
				throw new Error(`Unexpected role (must be actor): ${role}`);
			}
		},
	};
}

async function startActor(
	ctx: ActorContext,
	registry: Registry<any>,
	config: Config,
): Promise<void> {
	const { upgradeWebSocket } = await import("hono/deno");

	setupLogging();

	const portStr = Deno.env.get("PORT_HTTP");
	if (!portStr) {
		throw "Missing port";
	}
	const port = Number.parseInt(portStr);
	if (!Number.isFinite(port)) {
		throw "Invalid port";
	}

	const clientConfig: RivetClientConfig = getRivetClientConfig();

	const runConfig = {
		driver: {
			topology: "partition",
			manager: new RivetManagerDriver(clientConfig),
			actor: new RivetActorDriver(ctx),
		},
		getUpgradeWebSocket: () => upgradeWebSocket,
		...config,
	} satisfies RunConfig;

	// Initialization promise
	//
	// Resolve immediately if already initialized
	//
	// Otherwise, will wait for `POST /initialize` request
	const initializedPromise = Promise.withResolvers<void>();
	if ((await ctx.kv.get(["rivetkit", "initialized"])) === true) {
		initializedPromise.resolve(undefined);
	}

	//registry.config.inspector = {
	//	enabled: true,
	//	onRequest: async (c) => {
	//		const url = new URL(c.req.url);
	//		const token = url.searchParams.get("token");
	//
	//		if (!token) {
	//			return false;
	//		}
	//
	//		try {
	//			const response = await rivetRequest<void, { agent: unknown }>(
	//				{ endpoint, token },
	//				"GET",
	//				"/cloud/auth/inspect",
	//			);
	//			return "agent" in response;
	//		} catch (e) {
	//			return false;
	//		}
	//	},
	//};

	//const corsConfig = registry.config.cors;
	//
	//// Enable CORS for Rivet domains
	//registry.config.cors = {
	//	...registry.config.cors,
	//	origin: (origin, c) => {
	//		const isRivetOrigin =
	//			origin.endsWith(".rivet.gg") || origin.includes("localhost:");
	//		const configOrigin = corsConfig?.origin;
	//
	//		if (isRivetOrigin) {
	//			return origin;
	//		}
	//		if (typeof configOrigin === "function") {
	//			return configOrigin(origin, c);
	//		}
	//		if (typeof configOrigin === "string") {
	//			return configOrigin;
	//		}
	//		return null;
	//	},
	//};

	// Create actor topology
	const actorTopology = new PartitionTopologyActor(registry.config, runConfig);

	// Set a catch-all route
	const router = actorTopology.router;

	// TODO: This needs to be secured
	// TODO: This needs to assert this has only been called once
	// Initialize with data
	router.post("/initialize", async (c) => {
		const bodyBlob = await c.req.blob();
		const bodyBytes = await bodyBlob.bytes();
		const body = cbor.decode(bodyBytes);

		logger().debug("received initialize request", {
			hasInput: !!body.input,
		});

		// Write input
		if (body.input) {
			await ctx.kv.putBatch(
				new Map([
					[["rivetkit", "input", "exists"], true],
					[["rivetkit", "input", "data"], body.input],
				]),
			);
		}

		// Finish initialization
		initializedPromise.resolve(undefined);

		return c.body(cbor.encode({}), 200);
	});

	// Start server
	logger().info("server running", { port });
	const server = Deno.serve(
		{
			port,
			hostname: "0.0.0.0",
			// Remove "Listening on ..." message
			onListen() {},
		},
		router.fetch,
	);

	// Assert name exists
	if (!("name" in ctx.metadata.actor.tags)) {
		throw new Error(
			`Tags for actor ${ctx.metadata.actor.id} do not contain property name: ${JSON.stringify(ctx.metadata.actor.tags)}`,
		);
	}

	// Extract key from Rivet's tag format
	const key = extractKeyFromRivetTags(ctx.metadata.actor.tags);

	// Start actor after initialized
	await initializedPromise.promise;
	await actorTopology.start(
		ctx.metadata.actor.id,
		ctx.metadata.actor.tags.name,
		key,
		ctx.metadata.region.id,
	);

	// Wait for server
	await server.finished;
}

// Helper function to extract key array from Rivet's tag format
function extractKeyFromRivetTags(tags: Record<string, string>): string[] {
	invariant(typeof tags.key === "string", "key tag does not exist");
	return deserializeKeyFromTag(tags.key);
}
