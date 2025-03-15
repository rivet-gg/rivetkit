import { ActorTagsSchema, type ActorTags } from "@/common//utils";
import { z } from "zod";

export const CreateRequestSchema = z.object({
	name: z.string(),
	tags: ActorTagsSchema,
	region: z.string().optional(),
});

export const GetOrCreateRequestSchema = z.object({
	name: z.string(),
	tags: ActorTagsSchema,
	create: CreateRequestSchema.optional(),
});

export const ActorQuerySchema = z.union([
	z.object({
		getForId: z.object({
			actorId: z.string(),
		}),
	}),
	z.object({
		getOrCreateForTags: GetOrCreateRequestSchema,
	}),
	z.object({
		create: CreateRequestSchema,
	}),
]);

export type ActorQuery = z.infer<typeof ActorQuerySchema>;
export type GetOrCreateRequest = z.infer<typeof GetOrCreateRequestSchema>;
/**
 * Interface representing a request to create an actor.
 */
export type CreateRequest = z.infer<typeof CreateRequestSchema>;
