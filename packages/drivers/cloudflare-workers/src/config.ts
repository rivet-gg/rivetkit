import { RunConfigSchema } from "@rivetkit/core/driver-helpers";
import type { Hono } from "hono";
import { z } from "zod";

export const ConfigSchema = RunConfigSchema.removeDefault()
	.omit({ driver: true, getUpgradeWebSocket: true })
	.extend({
		app: z.custom<Hono>().optional(),
	})
	.default({});
export type InputConfig = z.input<typeof ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
