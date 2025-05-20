import { z } from "zod";

const InitSchema = z.object({
	// Conn Params
	p: z.unknown({}).optional(),
});

const RpcRequestSchema = z.object({
	// ID
	i: z.number().int(),
	// Name
	n: z.string(),
	// Args
	a: z.array(z.unknown()),
});

const SubscriptionRequestSchema = z.object({
	// Event name
	e: z.string(),
	// Subscribe
	s: z.boolean(),
});

export const ToServerSchema = z.object({
	// Body
	b: z.union([
		z.object({ i: InitSchema }),
		z.object({ rr: RpcRequestSchema }),
		z.object({ sr: SubscriptionRequestSchema }),
	]),
});

export type ToServer = z.infer<typeof ToServerSchema>;
export type RpcRequest = z.infer<typeof RpcRequestSchema>;
export type SubscriptionRequest = z.infer<typeof SubscriptionRequestSchema>;
