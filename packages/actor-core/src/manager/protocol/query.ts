import { ActorKeySchema, type ActorKey } from "@/common//utils";
import { z } from "zod";
import { EncodingSchema } from "@/actor/protocol/serde";

export const CreateRequestSchema = z.object({
	name: z.string(),
	key: ActorKeySchema,
	region: z.string().optional(),
});

export const GetForKeyRequestSchema = z.object({
	name: z.string(),
	key: ActorKeySchema,
});

export const GetOrCreateRequestSchema = z.object({
	name: z.string(),
	key: ActorKeySchema,
	region: z.string().optional(),
});

export const ActorQuerySchema = z.union([
	z.object({
		getForId: z.object({
			actorId: z.string(),
		}),
	}),
	z.object({
		getForKey: GetForKeyRequestSchema,
	}),
	z.object({
		getOrCreateForKey: GetOrCreateRequestSchema,
	}),
	z.object({
		create: CreateRequestSchema,
	}),
]);

export const ConnectQuerySchema = z.object({
	query: ActorQuerySchema,
	encoding: EncodingSchema,
	params: z.string().optional(),
});

export type ActorQuery = z.infer<typeof ActorQuerySchema>;
export type GetForKeyRequest = z.infer<typeof GetForKeyRequestSchema>;
export type GetOrCreateRequest = z.infer<typeof GetOrCreateRequestSchema>;
export type ConnectQuery = z.infer<typeof ConnectQuerySchema>;
/**
 * Interface representing a request to create an actor.
 */
export type CreateRequest = z.infer<typeof CreateRequestSchema>;
