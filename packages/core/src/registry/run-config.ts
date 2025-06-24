import { z } from "zod";
import type { Hono } from "hono";
import type { CoordinateDriver } from "@/topologies/coordinate/driver";
import type { ManagerDriver } from "@/manager/driver";
import type { WorkerDriver } from "@/worker/driver";
import type { UpgradeWebSocket } from "@/utils";
import type { cors } from "hono/cors";
import { createMemoryDriver } from "@/drivers/memory/mod";

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

export const TopologySchema = z.enum(["standalone", "partition", "coordinate"]);
export type Topology = z.infer<typeof TopologySchema>;

export type GetUpgradeWebSocket = (router: Hono) => UpgradeWebSocket;

export const DriverConfigSchema = z.object({
	topology: TopologySchema,
	manager: z.custom<ManagerDriver>(),
	worker: z.custom<WorkerDriver>(),
	coordinate: z.custom<CoordinateDriver>().optional(),
});

export type DriverConfig = z.infer<typeof DriverConfigSchema>;

/** Base config used for the worker config across all platforms. */
export const RunConfigSchema = z
	.object({
		driver: DriverConfigSchema.optional().default(() => createMemoryDriver()),

		// This is dynamic since NodeJS requires a reference to the router to initialize WebSockets
		getUpgradeWebSocket: z.custom<GetUpgradeWebSocket>().optional(),

		/** CORS configuration for the router. Uses Hono's CORS middleware options. */
		cors: z.custom<CorsOptions>().optional(),

		maxIncomingMessageSize: z.number().optional().default(65_536),

		/** Peer configuration for coordinated topology. */
		workerPeer: WorkerPeerConfigSchema.optional().default({}),

		// inspector: InspectorConfigSchema.optional().default({ enabled: false }),
	}).default({});

export type RunConfig = z.infer<typeof RunConfigSchema>;
export type RunConfigInput = z.input<typeof RunConfigSchema>;
