import { setupLogging } from "rivetkit/log";
import { upgradeWebSocket } from "hono/deno";
import { logger } from "./log";
import { deserializeKeyFromTag, type RivetHandler } from "./util";
import { PartitionTopologyWorker } from "rivetkit/topologies/partition";
import { RivetWorkerDriver } from "./worker-driver";
import invariant from "invariant";
import type { ActorContext } from "@rivet-gg/actor-core";
import { Registry, RunConfig } from "rivetkit";
import { type Config, ConfigSchema, type InputConfig } from "./config";
import { stringifyError } from "rivetkit/utils";
import { RivetManagerDriver } from "./manager-driver";
import { RivetClientConfig } from "./rivet-client";

export function createWorkerHandler(
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
			if (role === "worker") {
				await startWorker(ctx, registry, config);
			} else {
				throw new Error(`Unexpected role (must be worker): ${role}`);
			}
		},
	};
}

async function startWorker(
	ctx: ActorContext,
	registry: Registry<any>,
	config: Config,
): Promise<void> {
	setupLogging();

	const portStr = Deno.env.get("PORT_HTTP");
	if (!portStr) {
		throw "Missing port";
	}
	const port = Number.parseInt(portStr);
	if (!Number.isFinite(port)) {
		throw "Invalid port";
	}

	const endpoint = Deno.env.get("RIVET_ENDPOINT");
	if (!endpoint) throw new Error("missing RIVET_ENDPOINT");
	const token = Deno.env.get("RIVET_SERVICE_TOKEN");
	if (!token) throw new Error("missing RIVET_SERVICE_TOKEN");
	const project = Deno.env.get("RIVET_PROJECT");
	if (!project) throw new Error("missing RIVET_PROJECT");
	const environment = Deno.env.get("RIVET_ENVIRONMENT");
	if (!environment) throw new Error("missing RIVET_ENVIRONMENT");

	const clientConfig: RivetClientConfig = {
		endpoint,
		token,
		project,
		environment,
	};

	const runConfig = {
		driver: {
			topology: "partition",
			manager: new RivetManagerDriver(clientConfig),
			worker: new RivetWorkerDriver(ctx),
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

	// Create worker topology
	const workerTopology = new PartitionTopologyWorker(
		registry.config,
		runConfig,
	);

	// Set a catch-all route
	const router = workerTopology.router;

	// TODO: This needs to be secured
	// TODO: This needs to assert this has only been called once
	// Initialize with data
	router.post("/initialize", async (c) => {
		const body = await c.req.json();

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

		return c.json({}, 200);
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
			`Tags for worker ${ctx.metadata.actor.id} do not contain property name: ${JSON.stringify(ctx.metadata.actor.tags)}`,
		);
	}

	// Extract key from Rivet's tag format
	const key = extractKeyFromRivetTags(ctx.metadata.actor.tags);

	// Start worker after initialized
	await initializedPromise.promise;
	await workerTopology.start(
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
