import type { HonoRequest } from "hono";
import { z } from "zod";

export const InspectorConfigSchema = z.object({
	enabled: z.boolean().optional().default(false),
	/**
	 * Handler for incoming requests.
	 * A best place to add authentication.
	 */
	onRequest: z
		.function()
		.args(z.object({ req: z.custom<HonoRequest>() }))
		.returns(z.promise(z.boolean()).or(z.boolean()))
		.optional(),
});
export type InspectorConfig = z.infer<typeof InspectorConfigSchema>;
