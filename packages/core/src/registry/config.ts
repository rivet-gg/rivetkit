//! These configs configs hold anything that's not platform-specific about running workers.

import { AnyWorkerDefinition, WorkerDefinition } from "@/worker/definition";
import { z } from "zod";

export const WorkersSchema = z.record(
	z.string(),
	z.custom<WorkerDefinition<any, any, any, any, any, any, any>>(),
);
export type RegistryWorkers = z.infer<typeof WorkersSchema>;

export const TestConfigSchema = z.object({ enabled: z.boolean() });
export type TestConfig = z.infer<typeof TestConfigSchema>;

/** Base config used for the worker config across all platforms. */
export const RegistryConfigSchema = z.object({
	workers: z.record(z.string(), z.custom<AnyWorkerDefinition>()),

	// TODO: Find a better way of passing around the test config
	/**
	 * Test configuration.
	 *
	 * DO NOT MANUALLY ENABLE. THIS IS USED INTERNALLY.
	 **/
	test: TestConfigSchema.optional().default({ enabled: false }),
});
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
export type RegistryConfigInput<A extends RegistryWorkers> = Omit<
	z.input<typeof RegistryConfigSchema>,
	"workers"
> & { workers: A };
