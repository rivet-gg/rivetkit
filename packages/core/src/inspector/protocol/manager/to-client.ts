import { z } from "zod";
import { ActorSchema } from "../common";

export const ToClientSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("info"),
		actors: z.array(ActorSchema),
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
