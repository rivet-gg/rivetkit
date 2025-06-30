import z from "zod/v4";

export const ActorId = z.string().brand("ActorId");
export type ActorId = z.infer<typeof ActorId>;

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
  id: ActorId,
  name: z.string(),
  key: z.array(z.string()),
  tags: z.record(z.string(), z.string()).optional(),
  region: z.string().optional(),
  createdAt: z.string().optional(),
  startedAt: z.string().optional(),
  destroyedAt: z.string().optional(),
  features: z.array(z.enum(ActorFeature)).optional(),
});

export type Actor = z.infer<typeof ActorSchema>;
export type ActorLogEntry = z.infer<typeof ActorLogEntry>;

export const OperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("remove"),
    path: z.string(),
  }),
  z.object({
    op: z.literal("add"),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("replace"),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("move"),
    path: z.string(),
    from: z.string(),
  }),
  z.object({
    op: z.literal("copy"),
    path: z.string(),
    from: z.string(),
  }),
  z.object({
    op: z.literal("test"),
    path: z.string(),
    value: z.unknown(),
  }),
]);
export type Operation = z.infer<typeof OperationSchema>;

export const PatchSchema = z.array(OperationSchema);
export type Patch = z.infer<typeof PatchSchema>;
