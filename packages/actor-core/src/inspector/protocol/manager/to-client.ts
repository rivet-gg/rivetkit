import { z } from "zod";

const ActorSchema = z.object({
	id: z.string(),
	name: z.string(),
	key: z.array(z.string()),
});

export type Actor = z.infer<typeof ActorSchema>;

export const ToClientSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("info"),
		actors: z.array(ActorSchema),
		types: z.array(z.string()),
	}),
	z.object({
		type: z.literal("actors"),
		actors: z.array(ActorSchema),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
	}),
]);

export type ToClient = z.infer<typeof ToClientSchema>;
