import { z } from "zod";

// Only called for SSE because we don't need this for WebSockets
export const InitSchema = z.object({
	// Connection ID
	ci: z.string(),
	// Connection token
	ct: z.string(),
});

// Used for connection errors (both during initialization and afterwards)
export const ErrorSchema = z.object({
	// Code
	c: z.string(),
	// Message
	m: z.string(),
	// Metadata
	md: z.unknown().optional(),
	// RPC ID
	ri: z.number().int().optional(),
});

export const RpcResponseSchema = z.object({
	// ID
	i: z.number().int(),
	// Output
	o: z.unknown(),
});

export const EventSchema = z.object({
	// Name
	n: z.string(),
	// Args
	a: z.array(z.unknown()),
});

export const ToClientSchema = z.object({
	// Body
	b: z.union([
		z.object({ i: InitSchema }),
		z.object({ e: ErrorSchema }),
		z.object({ rr: RpcResponseSchema }),
		z.object({ ev: EventSchema }),
	]),
});

export type ToClient = z.infer<typeof ToClientSchema>;
export type Error = z.infer<typeof ErrorSchema>;
export type RpcResponse = z.infer<typeof RpcResponseSchema>;
export type Event = z.infer<typeof EventSchema>;
