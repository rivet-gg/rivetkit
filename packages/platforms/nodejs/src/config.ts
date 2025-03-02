import { BaseConfigSchema } from "actor-core/driver-helpers";
import { z } from "zod";

export const ConfigSchema = BaseConfigSchema.extend({
	hostname: z
		.string()
		.optional()
		.default(process.env.HOSTNAME ?? "127.0.0.1"),
	port: z
		.number()
		.optional()
		.default(Number.parseInt(process.env.PORT ?? "8787")),
});
export type InputConfig = z.input<typeof ConfigSchema>;
