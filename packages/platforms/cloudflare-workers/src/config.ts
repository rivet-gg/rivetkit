import { DriverConfigSchema } from "actor-core/driver-helpers";
import { z } from "zod";

export const ConfigSchema = DriverConfigSchema.default({});
export type InputConfig = z.input<typeof ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
