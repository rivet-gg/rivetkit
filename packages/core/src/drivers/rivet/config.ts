import { RunConfigSchema } from "@/driver-helpers/mod";
import { z } from "zod";

export const ConfigSchema = RunConfigSchema.removeDefault().omit({
	driver: true,
	getUpgradeWebSocket: true,
}).default({})
export type InputConfig = z.input<typeof ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
