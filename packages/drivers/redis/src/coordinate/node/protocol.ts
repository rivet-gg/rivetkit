import type { Encoding } from "@rivetkit/core";
import { z } from "zod";

// Shared schema for Uint8Array validation
export const Uint8ArraySchema = z
	.any()
	.refine((val): val is Uint8Array => val instanceof Uint8Array, {
		message: "Must be a Uint8Array",
	});
// import * as messageToClient from "@/actor/protocol/message/to-client";
// import * as messageToServer from "@/actor/protocol/message/to-server";

export const AckSchema = z.object({
	// Message ID
	m: z.string(),
});

export type Ack = z.infer<typeof AckSchema>;

// Raw HTTP request forwarding
export const ToLeaderFetchSchema = z.object({
	// Request ID (for matching response)
	ri: z.string(),
	// Actor ID
	ai: z.string(),
	// Request method
	method: z.string(),
	// Request URL (path only)
	url: z.string(),
	// Request headers
	headers: z.record(z.string()),
	// Request body (string or binary data)
	body: z.union([z.string(), Uint8ArraySchema]).optional(),
	// Auth data
	ad: z.unknown(),
});

export type ToLeaderFetch = z.infer<typeof ToLeaderFetchSchema>;

export const ToFollowerFetchResponseSchema = z.object({
	// Request ID
	ri: z.string(),
	// Response status
	status: z.number(),
	// Response headers
	headers: z.record(z.string()),
	// Response body (string or binary data)
	body: z.union([z.string(), Uint8ArraySchema]).optional(),
	// Error message (if failed)
	error: z.string().optional(),
});

export type ToFollowerFetchResponse = z.infer<
	typeof ToFollowerFetchResponseSchema
>;

// Raw WebSocket forwarding
export const ToLeaderWebSocketOpenSchema = z.object({
	// Actor ID
	ai: z.string(),
	// WebSocket ID (like connection ID)
	wi: z.string(),
	// Request URL (path only)
	url: z.string(),
	// Encoding
	e: z.custom<Encoding>(),
	// Conn params
	cp: z.unknown().optional(),
	// Auth data
	ad: z.unknown().optional(),
});

export type ToLeaderWebSocketOpen = z.infer<typeof ToLeaderWebSocketOpenSchema>;

export const ToLeaderWebSocketMessageSchema = z.object({
	// WebSocket ID
	wi: z.string(),
	// Message data (string or binary data)
	data: z.union([z.string(), Uint8ArraySchema]),
	// Is binary
	binary: z.boolean(),
});

export type ToLeaderWebSocketMessage = z.infer<
	typeof ToLeaderWebSocketMessageSchema
>;

export const ToLeaderWebSocketCloseSchema = z.object({
	// WebSocket ID
	wi: z.string(),
	// Close code
	code: z.number().optional(),
	// Close reason
	reason: z.string().optional(),
});

export type ToLeaderWebSocketClose = z.infer<
	typeof ToLeaderWebSocketCloseSchema
>;

export const ToFollowerWebSocketOpenSchema = z.object({
	// WebSocket ID
	wi: z.string(),
});

export type ToFollowerWebSocketOpen = z.infer<
	typeof ToFollowerWebSocketOpenSchema
>;

export const ToFollowerWebSocketMessageSchema = z.object({
	// WebSocket ID
	wi: z.string(),
	// Message data (string or binary data)
	data: z.union([z.string(), Uint8ArraySchema]),
	// Is binary
	binary: z.boolean(),
});

export type ToFollowerWebSocketMessage = z.infer<
	typeof ToFollowerWebSocketMessageSchema
>;

export const ToFollowerWebSocketCloseSchema = z.object({
	// WebSocket ID
	wi: z.string(),
	// Close code
	code: z.number().optional(),
	// Close reason
	reason: z.string().optional(),
});

export type ToFollowerWebSocketClose = z.infer<
	typeof ToFollowerWebSocketCloseSchema
>;

// Data sent between peers
export const NodeMessageSchema = z.object({
	// Node sending the message (only required if waiting for ack)
	n: z.string().optional(),
	// Message ID (will ack if provided if provided)
	m: z.string().optional(),
	// Body
	b: z.union([
		// Universal
		z.object({ a: AckSchema }),

		// Raw HTTP
		z.object({ lf: ToLeaderFetchSchema }),
		z.object({ ffr: ToFollowerFetchResponseSchema }),

		// Raw WebSocket
		z.object({ lwo: ToLeaderWebSocketOpenSchema }),
		z.object({ lwm: ToLeaderWebSocketMessageSchema }),
		z.object({ lwc: ToLeaderWebSocketCloseSchema }),
		z.object({ fwo: ToFollowerWebSocketOpenSchema }),
		z.object({ fwm: ToFollowerWebSocketMessageSchema }),
		z.object({ fwc: ToFollowerWebSocketCloseSchema }),
	]),
});

export type NodeMessage = z.infer<typeof NodeMessageSchema>;
