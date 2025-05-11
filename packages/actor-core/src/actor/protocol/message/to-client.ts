import { z } from "zod";

// Only called for SSE because we don't need this for WebSockets
export const InitSchema = z.object({
	// Connection ID
	ci: z.string(),
	// Connection token
	ct: z.string(),
});

// Used for connection errors (both during initialization and afterwards)
export const ConnectionErrorSchema = z.object({
	// Code
	c: z.string(),
	// Message
	m: z.string(),
	// Metadata
	md: z.unknown().optional(),
});

export const RpcResponseOkSchema = z.object({
	// ID
	i: z.number().int(),
	// Output
	o: z.unknown(),
});

export const RpcResponseErrorSchema = z.object({
	// ID
	i: z.number().int(),
	// Code
	c: z.string(),
	// Message
	m: z.string(),
	// Metadata
	md: z.unknown().optional(),
});

export const ToClientEventSchema = z.object({
	// Name
	n: z.string(),
	// Args
	a: z.array(z.unknown()),
});

export const ToClientErrorSchema = z.object({
	// Code
	c: z.string(),
	// Message
	m: z.string(),
	// Metadata
	md: z.unknown().optional(),
});

export const ToClientSchema = z.object({
	// Body
	b: z.union([
		z.object({ i: InitSchema }),
		z.object({ ce: ConnectionErrorSchema }),
		z.object({ ro: RpcResponseOkSchema }),
		z.object({ re: RpcResponseErrorSchema }),
		z.object({ ev: ToClientEventSchema }),
		z.object({ er: ToClientErrorSchema }),
	]),
});

export type ToClient = z.infer<typeof ToClientSchema>;
export type ConnectionError = z.infer<typeof ConnectionErrorSchema>;
export type RpcResponseOk = z.infer<typeof RpcResponseOkSchema>;
export type RpcResponseError = z.infer<typeof RpcResponseErrorSchema>;
export type ToClientEvent = z.infer<typeof ToClientEventSchema>;
export type ToClientError = z.infer<typeof ToClientErrorSchema>;
