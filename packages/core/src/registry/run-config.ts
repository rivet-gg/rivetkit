import type { cors } from "hono/cors";
import { z } from "zod";
import type { ActorDriverBuilder } from "@/actor/driver";
import { InspectorConfigSchema } from "@/inspector/config";
import type { ManagerDriverBuilder } from "@/manager/driver";
import type { UpgradeWebSocket } from "@/utils";

type CorsOptions = NonNullable<Parameters<typeof cors>[0]>;

export type GetUpgradeWebSocket = () => UpgradeWebSocket;

export const DriverConfigSchema = z.object({
	/** Machine-readable name to identify this driver by. */
	name: z.string(),
	manager: z.custom<ManagerDriverBuilder>(),
	actor: z.custom<ActorDriverBuilder>(),
});

export type DriverConfig = z.infer<typeof DriverConfigSchema>;

/** Base config used for the actor config across all platforms. */
export const RunConfigSchema = z
	.object({
		driver: DriverConfigSchema.optional(),

		/** Endpoint to connect to the Rivet engine. Can be configured via RIVET_ENGINE env var. */
		engine: z.string().optional(),

		// This is a function to allow for lazy configuration of upgradeWebSocket on the
		// fly. This is required since the dependencies that profie upgradeWebSocket
		// (specifically Node.js) can sometimes only be specified after the router is
		// created or must be imported async using `await import(...)`
		getUpgradeWebSocket: z.custom<GetUpgradeWebSocket>().optional(),

		role: z.enum(["all", "server", "runner"]).optional().default("all"),

		/** CORS configuration for the router. Uses Hono's CORS middleware options. */
		cors: z.custom<CorsOptions>().optional(),

		maxIncomingMessageSize: z.number().optional().default(65_536),

		studio: InspectorConfigSchema,

		/**
		 * Base path for the router. This is used to prefix all routes.
		 * For example, if the base path is `/api`, then the route `/actors` will be
		 * available at `/api/actors`.
		 */
		basePath: z.string().optional().default("/"),
	})
	.default({});

export type RunConfig = z.infer<typeof RunConfigSchema>;
export type RunConfigInput = z.input<typeof RunConfigSchema>;
