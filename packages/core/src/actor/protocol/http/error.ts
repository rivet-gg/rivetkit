import { z } from "zod";

export const ResponseErrorSchema = z.object({
	// Code
	c: z.string(),
	// Message
	m: z.string(),
	// Metadata
	md: z.unknown().optional(),
});

export type ResponseError = z.infer<typeof ResponseErrorSchema>;
