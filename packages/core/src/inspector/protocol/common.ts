import z from "zod";

export enum ActorFeature {
	Logs = "logs",
	Config = "config",
	Connections = "connections",
	State = "state",
	Console = "console",
	Runtime = "runtime",
	Metrics = "metrics",
}

export const ActorLogEntry = z.object({
	level: z.string(),
	message: z.string(),
	timestamp: z.string(),
	metadata: z.record(z.string(), z.any()).optional(),
});

export const ActorSchema = z.object({
	id: z.string(),
	name: z.string(),
	key: z.array(z.string()),
	tags: z.record(z.string(), z.string()).optional(),
	region: z.string().optional(),
	createdAt: z.string().optional(),
	startedAt: z.string().optional(),
	destroyedAt: z.string().optional(),
	features: z.array(z.nativeEnum(ActorFeature)).optional(),
});

export type Actor = z.infer<typeof ActorSchema>;
export type ActorLogEntry = z.infer<typeof ActorLogEntry>;
