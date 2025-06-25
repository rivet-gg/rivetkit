import { z } from "zod";

export const ActionRequestSchema = z.object({
	// Args
	a: z.array(z.unknown()),
});

export const ActionResponseSchema = z.object({
	// Output
	o: z.unknown(),
});


export type ActionRequest = z.infer<typeof ActionRequestSchema>;
export type ActionResponse = z.infer<typeof ActionResponseSchema>;
