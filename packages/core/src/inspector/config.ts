import { getEnvUniversal } from "@/utils";
import type { Context } from "hono";
import { z } from "zod";

export const InspectorConfigSchema = z
	.object({
		enabled: z.boolean().optional(),
		/**
		 * Handler for incoming requests.
		 * The best place to add authentication for inspector requests.
		 * If this returns `false`, the request will be rejected.
		 */
		onRequest: z
			.function()
			.args(z.custom<Context>())
			.returns(z.promise(z.boolean()).or(z.boolean()))
			.optional(),
	})
	.optional()
	.default({ enabled: getEnvUniversal("NODE_ENV") !== "production" });
export type InspectorConfig = z.infer<typeof InspectorConfigSchema>;
