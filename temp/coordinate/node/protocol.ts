import { z } from "zod";
import * as messageToClient from "@/actor/protocol/message/to-client";
import * as messageToServer from "@/actor/protocol/message/to-server";

export const AckSchema = z.object({
	// Message ID
	m: z.string(),
});

export type Ack = z.infer<typeof AckSchema>;

export const ToLeaderConnectionOpenSchema = z.object({
	// Actor ID
	ai: z.string(),
	// Connection ID
	ci: z.string(),
	// Connection token
	ct: z.string(),
	// Parameters
	p: z.unknown(),
	// Auth data
	ad: z.unknown(),
});

export type ToLeaderConnectionOpen = z.infer<
	typeof ToLeaderConnectionOpenSchema
>;

export const ToLeaderConnectionCloseSchema = z.object({
	// Actor ID
	ai: z.string(),
	// Connection ID
	ci: z.string(),
});

export type ToLeaderConnectionClose = z.infer<
	typeof ToLeaderConnectionCloseSchema
>;

export const ToLeaderMessageSchema = z.object({
	// Actor ID
	ai: z.string(),
	// Connection ID
	ci: z.string(),
	// Connection token
	ct: z.string(),
	// TODO: wsToServer.ToServerSchema
	m: messageToServer.ToServerSchema,
});

export type ToLeaderMessage = z.infer<typeof ToLeaderMessageSchema>;

export const ToLeaderActionSchema = z.object({
	// Request ID (to match with the response)
	ri: z.string(),
	// Actor ID
	ai: z.string(),
	// Action name
	an: z.string(),
	// Action arguments
	aa: z.array(z.unknown()),
	// Parameters
	p: z.unknown(),
	// Auth data
	ad: z.unknown(),
});

export type ToLeaderAction = z.infer<typeof ToLeaderActionSchema>;

export const ToFollowerActionResponseSchema = z.object({
	// Request ID (to match with the request)
	ri: z.string(),
	// Success flag
	s: z.boolean(),
	// Output (if successful)
	o: z.unknown().optional(),
	// Error message (if failed)
	e: z.string().optional(),
});

export type ToFollowerActionResponse = z.infer<
	typeof ToFollowerActionResponseSchema
>;

export const ToFollowerConnectionCloseSchema = z.object({
	// Connection ID
	ci: z.string(),
	// Reason
	r: z.string().optional(),
});

export type ToFollowerConnectionClose = z.infer<
	typeof ToFollowerConnectionCloseSchema
>;

export const ToFollowerMessageSchema = z.object({
	// Connection ID
	ci: z.string(),
	// Message
	m: messageToClient.ToClientSchema,
});

export type ToFollowerMessage = z.infer<typeof ToFollowerMessageSchema>;

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
	// Request body (base64 encoded if binary)
	body: z.string().optional(),
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
	// Response body (base64 encoded if binary)
	body: z.string().optional(),
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
	// Request headers
	headers: z.record(z.string()),
	// Auth data
	ad: z.unknown(),
});

export type ToLeaderWebSocketOpen = z.infer<typeof ToLeaderWebSocketOpenSchema>;

export const ToLeaderWebSocketMessageSchema = z.object({
	// WebSocket ID
	wi: z.string(),
	// Message data (base64 encoded if binary)
	data: z.string(),
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

export const ToFollowerWebSocketMessageSchema = z.object({
	// WebSocket ID
	wi: z.string(),
	// Message data (base64 encoded if binary)
	data: z.string(),
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

		// Leader
		z.object({ lco: ToLeaderConnectionOpenSchema }),
		z.object({ lcc: ToLeaderConnectionCloseSchema }),
		z.object({ lm: ToLeaderMessageSchema }),
		z.object({ la: ToLeaderActionSchema }),

		// Follower
		z.object({ fcc: ToFollowerConnectionCloseSchema }),
		z.object({ fm: ToFollowerMessageSchema }),
		z.object({ far: ToFollowerActionResponseSchema }),

		// Raw HTTP
		z.object({ lf: ToLeaderFetchSchema }),
		z.object({ ffr: ToFollowerFetchResponseSchema }),

		// Raw WebSocket
		z.object({ lwo: ToLeaderWebSocketOpenSchema }),
		z.object({ lwm: ToLeaderWebSocketMessageSchema }),
		z.object({ lwc: ToLeaderWebSocketCloseSchema }),
		z.object({ fwm: ToFollowerWebSocketMessageSchema }),
		z.object({ fwc: ToFollowerWebSocketCloseSchema }),
	]),
});

export type NodeMessage = z.infer<typeof NodeMessageSchema>;
