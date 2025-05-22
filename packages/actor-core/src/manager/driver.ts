import type { ActorKey } from "@/common/utils";
import type { ManagerInspector } from "@/inspector/manager";
import type { Env, Context as HonoContext } from "hono";

export interface ManagerDriver {
	getForId(input: GetForIdInput): Promise<ActorOutput | undefined>;
	getWithKey(input: GetWithKeyInput): Promise<ActorOutput | undefined>;
	getOrCreateWithKey(input: GetOrCreateWithKeyInput): Promise<ActorOutput>;
	createActor(input: CreateInput): Promise<ActorOutput>;

	inspector?: ManagerInspector;
}
export interface GetForIdInput<E extends Env = any> {
	c?: HonoContext<E>;
	actorId: string;
}

export interface GetWithKeyInput<E extends Env = any> {
	c?: HonoContext<E>;
	name: string;
	key: ActorKey;
}

export interface GetOrCreateWithKeyInput<E extends Env = any> {
	c?: HonoContext<E>;
	name: string;
	key: ActorKey;
	input?: unknown;
	region?: string;
}

export interface CreateInput<E extends Env = any> {
	c?: HonoContext<E>;
	name: string;
	key: ActorKey;
	input?: unknown;
	region?: string;
}

export interface ActorOutput {
	actorId: string;
	name: string;
	key: ActorKey;
	meta?: unknown;
}
