import type * as messageToClient from "@/actor/protocol/message/to-client";
import type { CachedSerializer } from "@/actor/protocol/serde";
import type { AnyActorInstance } from "./instance";
import { AnyConn } from "./connection";

export type ConnDrivers = Record<string, ConnDriver>;

export type KvKey = unknown[];
export type KvValue = unknown;


export interface ActorDriver {
	//load(): Promise<LoadOutput>;
	get context(): unknown;

	// HACK: Clean these up
	kvGet(actorId: string, key: KvKey): Promise<KvValue | undefined>;
	kvGetBatch(actorId: string, key: KvKey[]): Promise<(KvValue | undefined)[]>;
	kvPut(actorId: string, key: KvKey, value: KvValue): Promise<void>;
	kvPutBatch(actorId: string, key: [KvKey, KvValue][]): Promise<void>;
	kvDelete(actorId: string, key: KvKey): Promise<void>;
	kvDeleteBatch(actorId: string, key: KvKey[]): Promise<void>;

	// Schedule
	setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void>;

	// TODO:
	//destroy(): Promise<void>;
	//readState(): void;
}

export interface ConnDriver<ConnDriverState = unknown> {
	sendMessage(
		actor: AnyActorInstance,
		conn: AnyConn,
		state: ConnDriverState,
		message: CachedSerializer<messageToClient.ToClient>,
	): void;

	/**
	 * This returns a promise since we commonly disconnect at the end of a program, and not waiting will cause the socket to not close cleanly.
	 */
	disconnect(
		actor: AnyActorInstance,
		conn: AnyConn,
		state: ConnDriverState,
		reason?: string,
	): Promise<void>;
}
