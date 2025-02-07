import { setupLogging } from "actor-core/log";
import type { ActorContext } from "@rivet-gg/actor-core";
import type { ActorTags } from "actor-core";
import { upgradeWebSocket } from "hono/deno";
import { logger } from "./log";
import type { RivetHandler } from "./util";
import {
	ActorDriver,
	AnyActor,
	AnyActorConstructor,
} from "actor-core/platform";
import {
	createGenericActorRouter,
	createGenericConnectionDrivers,
	createGenericDriverGlobalState,
	GenericDriverGlobalState,
} from "actor-core/actor/generic";
import type { Config } from "./config";

export function createHandler(
	actorPrototype: AnyActorConstructor,
	config: Config = {},
): RivetHandler {
	const handler = {
		async start(ctx: ActorContext): Promise<void> {
			setupLogging();

			const portStr = Deno.env.get("PORT_HTTP");
			if (!portStr) {
				throw "Missing port";
			}
			const port = Number.parseInt(portStr);
			if (!Number.isFinite(port)) {
				throw "Invalid port";
			}

			// Create actor
			const actor = new actorPrototype();

			// Create driver
			const driverGlobal = createGenericDriverGlobalState();
			const driver = createActorDriver(ctx, actor, driverGlobal);

			// Create router
			const router = createGenericActorRouter({
				config,
				driverGlobal,
				actor,
				upgradeWebSocket,
			});

			router.all("*", (c) => {
				return c.text("Not Found (ActorCore)", 404);
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

			// Start actor
			await actor.__start(
				driver,
				ctx.metadata.actor.id,
				ctx.metadata.actor.tags as ActorTags,
				ctx.metadata.region.id,
			);

			// Wait for server
			await server.finished;
		},
	} satisfies RivetHandler;

	return handler;
}

function createActorDriver(
	ctx: ActorContext,
	actor: AnyActor,
	driverGlobal: GenericDriverGlobalState,
): ActorDriver {
	return {
		connectionDrivers: createGenericConnectionDrivers(driverGlobal),

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		async kvGet(key: any): Promise<any> {
			return await ctx.kv.get(key);
		},

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		async kvGetBatch(key: any[]) {
			const response = await ctx.kv.getBatch(key);
			const resultList = key.map((key) => {
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				return [key, response.get(key)] as [any, any];
			});
			return resultList;
		},

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		async kvPut(key: any, value: any) {
			await ctx.kv.put(key, value);
		},

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		async kvPutBatch(key: [any, any][]) {
			await ctx.kv.putBatch(new Map(key));
		},

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		async kvDelete(key: any) {
			await ctx.kv.delete(key);
		},

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		async kvDeleteBatch(keys: any[]) {
			await ctx.kv.deleteBatch(keys);
		},

		async setAlarm(timestamp: number): Promise<void> {
			const timeout = Math.max(0, timestamp - Date.now());
			setTimeout(() => {
				actor.__onAlarm();
			}, timeout);
		},

		//async onShutdown() {
		//	if (server) await server.shutdown();
		//	Deno.exit(0);
		//}
	};
}
