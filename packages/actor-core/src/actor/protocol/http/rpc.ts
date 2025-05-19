import { z } from "zod";

export const RpcRequestSchema = z.object({
	// Args
	a: z.array(z.unknown()),
});

export const RpcResponseSchema = z.object({
	// Output
	o: z.unknown(),
});


export type RpcRequest = z.infer<typeof RpcRequestSchema>;
export type RpcResponse = z.infer<typeof RpcResponseSchema>;
