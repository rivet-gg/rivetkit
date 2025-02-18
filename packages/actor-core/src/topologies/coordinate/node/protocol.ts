import { z } from "zod";
import * as messageToServer from "@/actor/protocol/message/to_server"
import * as messageToClient from "@/actor/protocol/message/to_client"

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
});

export type ToLeaderConnectionOpen = z.infer<typeof ToLeaderConnectionOpenSchema>;

export const ToLeaderConnectionCloseSchema = z.object({
	// Actor ID
	ai: z.string(),
	// Connection ID
	ci: z.string(),
});

export type ToLeaderConnectionClose = z.infer<typeof ToLeaderConnectionCloseSchema>;

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

export const ToFollowerConnectionCloseSchema = z.object({
	// Connection ID
	ci: z.string(),
	// Reason
	r: z.string().optional(),
});

export type ToFollowerConnectionClose = z.infer<typeof ToFollowerConnectionCloseSchema>;

export const ToFollowerMessageSchema = z.object({
	// Connection ID
	ci: z.string(),
	// Message
	m: messageToClient.ToClientSchema,
});

export type ToFollowerMessage = z.infer<typeof ToFollowerMessageSchema>;

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

		// Follower
		z.object({ fcc: ToFollowerConnectionCloseSchema }),
		z.object({ fm: ToFollowerMessageSchema }),
	]),
});

export type NodeMessage = z.infer<typeof NodeMessageSchema>;
