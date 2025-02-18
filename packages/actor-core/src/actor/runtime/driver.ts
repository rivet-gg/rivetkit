import type { ActorTags, Connection } from "./mod";
import type * as messageToClient from "@/actor/protocol/message/to_client";
import type { CachedSerializer } from "@/actor/protocol/serde";
import type { AnyActor } from "./actor";

export type ConnectionDrivers = Record<string, ConnectionDriver>;

export interface GetForIdInput {
	origin: string;
	actorId: string;
}

export interface GetWithTagsInput {
	origin: string;
	tags: ActorTags;
}

export interface GetActorOutput {
	endpoint: string;
	tags: ActorTags;
}

export interface CreateActorInput {
	origin: string;
	region?: string;
	tags: ActorTags;
}

export interface CreateActorOutput {
	endpoint: string;
}

export interface ManagerDriver {
	getForId(input: GetForIdInput): Promise<GetActorOutput | undefined>;
	getWithTags(input: GetWithTagsInput): Promise<GetActorOutput | undefined>;
	createActor(input: CreateActorInput): Promise<CreateActorOutput>;
}

export type KvKey = unknown[];
export type KvValue = unknown;

export interface ActorDriver {
	//load(): Promise<LoadOutput>;

	// HACK: Clean these up
	kvGet(actorId: string, key: KvKey): Promise<KvValue | undefined>;
	kvGetBatch(actorId: string, key: KvKey[]): Promise<(KvValue | undefined)[]>;
	kvPut(actorId: string, key: KvKey, value: KvValue): Promise<void>;
	kvPutBatch(actorId: string, key: [KvKey, KvValue][]): Promise<void>;
	kvDelete(actorId: string, key: KvKey): Promise<void>;
	kvDeleteBatch(actorId: string, key: KvKey[]): Promise<void>;

	// Schedule
	setAlarm(actorId: string, timestamp: number): Promise<void>;

	// TODO:
	//destroy(): Promise<void>;
	//readState(): void;
}

export interface ConnectionDriver<ConnDriverState = unknown> {
	sendMessage(
		actor: AnyActor,
		conn: Connection<AnyActor>,
		state: ConnDriverState,
		message: CachedSerializer<messageToClient.ToClient>,
	): void;

	/**
	 * This returns a promise since we commonly disconnect at the end of a program, and not waiting will cause the socket to not close cleanly.
	 */
	disconnect(
		actor: AnyActor,
		conn: Connection<AnyActor>,
		state: ConnDriverState,
		reason?: string,
	): Promise<void>;
}
