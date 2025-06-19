//! These configs configs hold anything that's not platform-specific about running workers.

import { z } from "zod";
import type { cors } from "hono/cors";
import { WorkerDefinition, AnyWorkerDefinition } from "@/worker/definition";
import { InspectorConfigSchema } from "@/inspector/config";
// Define CORS options schema
type CorsOptions = NonNullable<Parameters<typeof cors>[0]>;

export const WorkerPeerConfigSchema = z.object({
	/**
	 * How long the worker leader holds a lease for.
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
export type WorkerPeerConfig = z.infer<typeof WorkerPeerConfigSchema>;

export const WorkersSchema = z.record(
	z.string(),
	z.custom<WorkerDefinition<any, any, any, any, any, any, any>>(),
);
export type Workers = z.infer<typeof WorkersSchema>;

export const TestConfigSchema = z.object({ enabled: z.boolean() });
export type TestConfig = z.infer<typeof TestConfigSchema>;

/** Base config used for the worker config across all platforms. */
export const RegistryConfigSchema = z.object({
	workers: z.record(z.string(), z.custom<AnyWorkerDefinition>()),

	/** CORS configuration for the router. Uses Hono's CORS middleware options. */
	cors: z.custom<CorsOptions>().optional(),

	/** Base path used to build URLs from. This is specifically used when returning the endpoint to connect to for workers. */
	basePath: z.string().optional(),

	/** This goes in the URL so it needs to be short. */
	maxConnParamLength: z.number().optional().default(8_192),

	maxIncomingMessageSize: z.number().optional().default(65_536),

	/** How long to wait for the WebSocket to send an init message before closing it. */
	webSocketInitTimeout: z.number().optional().default(5_000),

	/** Peer configuration for coordinated topology. */
	workerPeer: WorkerPeerConfigSchema.optional().default({}),

	/** Inspector configuration. */
	inspector: InspectorConfigSchema.optional().default({ enabled: false }),

	// TODO: Find a better way of passing around the test config
	/** 
	 * Test configuration.
	 *
	 * DO NOT MANUALLY ENABLE. THIS IS USED INTERNALLY.
	 **/
	test: TestConfigSchema.optional().default({ enabled: false }),
});
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
export type RegistryConfigInput<A extends Workers> = Omit<
	z.input<typeof RegistryConfigSchema>,
	"workers"
> & { workers: A };
