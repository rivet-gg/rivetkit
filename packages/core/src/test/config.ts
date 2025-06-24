import { RunConfigSchema } from "@/registry/run-config";
import { z } from "zod";

export const ConfigSchema = RunConfigSchema.removeDefault()
	.extend({
		hostname: z
			.string()
			.optional()
			.default(process.env.HOSTNAME ?? "127.0.0.1"),
		port: z
			.number()
			.optional()
			.default(Number.parseInt(process.env.PORT ?? "6420")),
	})
	.partial({ driver: true })
	.default({});
export type InputConfig = z.input<typeof ConfigSchema>;
