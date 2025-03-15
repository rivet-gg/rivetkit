import { ActorTags } from "@/common/utils";
import type { Env, Context as HonoContext } from "hono";


export interface ManagerDriver {
	getForId(input: GetForIdInput): Promise<GetActorOutput | undefined>;
	getWithTags(input: GetWithTagsInput): Promise<GetActorOutput | undefined>;
	createActor(input: CreateActorInput): Promise<CreateActorOutput>;
}export interface GetForIdInput<E extends Env = any> {
	c?: HonoContext<E>;
	baseUrl: string;
	actorId: string;
}

export interface GetWithTagsInput<E extends Env = any> {
	c?: HonoContext<E>;
	baseUrl: string;
	name: string;
	tags: ActorTags;
}

export interface GetActorOutput<E extends Env = any> {
	c?: HonoContext<E>;
	endpoint: string;
	name: string;
	tags: ActorTags;
}

export interface CreateActorInput<E extends Env = any> {
	c?: HonoContext<E>;
	baseUrl: string;
	name: string;
	tags: ActorTags;
	region?: string;
}

export interface CreateActorOutput {
	endpoint: string;
}

