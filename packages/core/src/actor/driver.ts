import type * as messageToClient from "@/actor/protocol/message/to-client";
import type { CachedSerializer } from "@/actor/protocol/serde";
import type { AnyConn } from "./connection";
import type { AnyActorInstance } from "./instance";

export type ConnDrivers = Record<string, ConnDriver>;

export interface ActorDriver {
	//load(): Promise<LoadOutput>;
	getContext(actorId: string): unknown;

	readInput(actorId: string): Promise<unknown | undefined>;

	readPersistedData(actorId: string): Promise<unknown | undefined>;
	writePersistedData(actorId: string, unknown: unknown): Promise<void>;

	// Schedule
	setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void>;

	// Database
	/**
	 * @experimental
	 * This is an experimental API that may change in the future.
	 */
	getDatabase(actorId: string): Promise<unknown | undefined>;

	// TODO:
	//destroy(): Promise<void>;
	//readState(): void;
}

export interface ConnDriver<ConnDriverState = unknown> {
	sendMessage?(
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
