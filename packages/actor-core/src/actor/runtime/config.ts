import { z } from "zod";
import type { AnyActorConstructor } from "./actor";
import type { ActorDriver, ManagerDriver } from "./driver";
import type { CoordinateDriver } from "@/driver-helpers";
import type {
	Hono,
	Context as HonoContext,
	Handler as HonoHandler,
} from "hono";
import type { cors } from "hono/cors";

// Define CORS options schema
type CorsOptions = NonNullable<Parameters<typeof cors>[0]>;

export const TopologySchema = z.enum(["standalone", "partition", "coordinate"]);
export type Topology = z.infer<typeof TopologySchema>;

export const ActorPeerConfigSchema = z.object({
	/**
	 * How long the actor leader holds a lease for.
	 *
	 * Milliseconds
	 **/
	leaseDuration: z.number().optional().default(3000),
	/**
	 * How long before the lease will expire to issue the renew command.
	 *
	 * Milliseconds
	 */
	renewLeaseGrace: z.number().optional().default(1500),
	/**
	 * How frequently the followers check if the leader is still active.
	 *
	 * Milliseconds
	 */
	checkLeaseInterval: z.number().optional().default(1000),
	/**
	 * Positive jitter for check lease interval
	 *
	 * Milliseconds
	 */
	checkLeaseJitter: z.number().optional().default(500),
	/**
	 * How long to wait for a message ack.
	 *
	 * Milliseconds
	 */
	messageAckTimeout: z.number().optional().default(1000),
});
export type ActorPeerConfig = z.infer<typeof ActorPeerConfigSchema>;

export type GetUpgradeWebSocket = (
	app: Hono,
) => (createEvents: (c: HonoContext) => any) => HonoHandler;

/** Base config used for the actor config across all platforms. */
export const BaseConfigSchema = z.object({
	actors: z.record(z.string(), z.custom<AnyActorConstructor>()),
	topology: TopologySchema.optional().default("standalone"),
	drivers: z
		.object({
			manager: z.custom<ManagerDriver>().optional(),
			actor: z.custom<ActorDriver>().optional(),
			coordinate: z.custom<CoordinateDriver>().optional(),
		})
		.optional()
		.default({}),

	/** CORS configuration for the router. Uses Hono's CORS middleware options. */
	cors: z.custom<CorsOptions>().optional(),

	// This is dynamic since NodeJS requires a reference to the app to initialize WebSockets
	getUpgradeWebSocket: z.custom<GetUpgradeWebSocket>().optional(),

	/** Base path used to build URLs from. This is specifically used when returning the endpoint to connect to for actors. */
	basePath: z.string().optional(),

	/** This goes in the URL so it needs to be short. */
	maxConnectionParametersSize: z.number().optional().default(8_192),

	maxIncomingMessageSize: z.number().optional().default(65_536),

	/** Peer configuration for coordinated topology. */
	actorPeer: ActorPeerConfigSchema.optional().default({}),
});
export type BaseConfig = z.infer<typeof BaseConfigSchema>;
