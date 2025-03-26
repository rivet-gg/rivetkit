import type { ActorCoreApp } from "actor-core";
import { DriverConfigSchema } from "actor-core/driver-helpers";
import { z } from "zod";

export const ConfigSchema = DriverConfigSchema.extend({
	app: z.custom<ActorCoreApp<any>>(),
});
export type InputConfig = z.input<typeof ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
