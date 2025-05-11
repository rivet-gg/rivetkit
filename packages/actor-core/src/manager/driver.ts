import type { ActorKey } from "@/common/utils";
import type { ManagerInspector } from "@/inspector/manager";
import type { Env, Context as HonoContext } from "hono";

export interface ManagerDriver {
	getForId(input: GetForIdInput): Promise<GetActorOutput | undefined>;
	getWithKey(input: GetWithKeyInput): Promise<GetActorOutput | undefined>;
	createActor(input: CreateActorInput): Promise<CreateActorOutput>;

	inspector?: ManagerInspector;
}
export interface GetForIdInput<E extends Env = any> {
	c?: HonoContext<E>;
	baseUrl: string;
	actorId: string;
}

export interface GetWithKeyInput<E extends Env = any> {
	c?: HonoContext<E>;
	baseUrl: string;
	name: string;
	key: ActorKey;
}

export interface GetActorOutput<E extends Env = any> {
	c?: HonoContext<E>;
	endpoint: string;
	name: string;
	key: ActorKey;
}

export interface CreateActorInput<E extends Env = any> {
	c?: HonoContext<E>;
	baseUrl: string;
	name: string;
	key: ActorKey;
	region?: string;
}

export interface CreateActorOutput {
	endpoint: string;
}
