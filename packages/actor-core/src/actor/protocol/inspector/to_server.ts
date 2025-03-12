import { z } from "zod";

export const ToServerSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("info"),
	}),
	z.object({
		type: z.literal("setState"),
		state: z.any(),
	}),
]);

export type ToServer = z.infer<typeof ToServerSchema>;
