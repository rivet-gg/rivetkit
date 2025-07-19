import { z } from "zod";

export const CoordinateDriverConfig = z.object({
	actorPeer: z.object({
		leaseDuration: z.number().default(3000),
		renewLeaseGrace: z.number().default(1500),
		checkLeaseInterval: z.number().default(1000),
		checkLeaseJitter: z.number().default(500),
		messageAckTimeout: z.number().default(1000),
	}),
});

export type CoordinateDriverConfig = z.infer<typeof CoordinateDriverConfig>;
