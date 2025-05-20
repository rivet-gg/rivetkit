//! These configs configs hold anything that's not platform-specific about running actors.

import { z } from "zod";
import type { cors } from "hono/cors";
import { ActorDefinition, AnyActorDefinition } from "@/actor/definition";
import { InspectorConfigSchema } from "@/inspector/config";

// Define CORS options schema
type CorsOptions = NonNullable<Parameters<typeof cors>[0]>;

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

export const ActorsSchema = z.record(
	z.string(),
	z.custom<ActorDefinition<any, any, any, any, any>>(),
);
export type Actors = z.infer<typeof ActorsSchema>;

/** Base config used for the actor config across all platforms. */
export const AppConfigSchema = z.object({
	actors: z.record(z.string(), z.custom<AnyActorDefinition>()),

	/** CORS configuration for the router. Uses Hono's CORS middleware options. */
	cors: z.custom<CorsOptions>().optional(),

	/** Base path used to build URLs from. This is specifically used when returning the endpoint to connect to for actors. */
	basePath: z.string().optional(),

	/** This goes in the URL so it needs to be short. */
	maxConnParamLength: z.number().optional().default(8_192),

	maxIncomingMessageSize: z.number().optional().default(65_536),

	/** How long to wait for the WebSocket to send an init message before closing it. */
	webSocketInitTimeout: z.number().optional().default(5_000),

	/** Peer configuration for coordinated topology. */
	actorPeer: ActorPeerConfigSchema.optional().default({}),

	/** Inspector configuration. */
	inspector: InspectorConfigSchema.optional().default({ enabled: false }),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AppConfigInput<A extends Actors> = Omit<
	z.input<typeof AppConfigSchema>,
	"actors"
> & { actors: A };
