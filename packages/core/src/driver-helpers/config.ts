//! These configs configs hold anything specific to the driver.
//!
//! This should only include parameters that affect the low-level infrastructure and does not affect behavior of workers. Configuring parameters in this block should not tweak how workers behave at all.
//!
//! For example, Rivet doesn't expose this functionality to the user at all and is completely configured automatically.

import { z } from "zod";
import type {
	Hono,
	Context as HonoContext,
	Handler as HonoHandler,
} from "hono";
import type { CoordinateDriver } from "@/topologies/coordinate/driver";
import type { ManagerDriver } from "@/manager/driver";
import type { WorkerDriver } from "@/worker/driver";
import { UpgradeWebSocket } from "@/utils";

export const TopologySchema = z.enum(["standalone", "partition", "coordinate"]);
export type Topology = z.infer<typeof TopologySchema>;

export type GetUpgradeWebSocket = (router: Hono) => UpgradeWebSocket;

/** Base config used for the worker config across all platforms. */
export const DriverConfigSchema = z.object({
	topology: TopologySchema.optional(), // Default value depends on the platform selected
	drivers: z
		.object({
			manager: z.custom<ManagerDriver>().optional(),
			worker: z.custom<WorkerDriver>().optional(),
			coordinate: z.custom<CoordinateDriver>().optional(),
		})
		.optional()
		.default({}),
	// This is dynamic since NodeJS requires a reference to the router to initialize WebSockets
	getUpgradeWebSocket: z.custom<GetUpgradeWebSocket>().optional(),
});
export type DriverConfig = z.infer<typeof DriverConfigSchema>;
