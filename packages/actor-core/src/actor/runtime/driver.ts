import { CachedSerializer } from "../protocol/serde";
import type * as messageToClient from "@/actor/protocol/message/to_client";
import { AnyActor } from "./actor";
import { Connection } from "./connection";

export interface LoadOutput {
	actor: {
		id: string;
		tags: Record<string, string>;
		createdAt: Date;
	};
	region: string;
}

export interface ActorDriver {
	connectionDrivers: Record<string, ConnectionDriver>;

	//load(): Promise<LoadOutput>;

	// HACK: Clean these up
	kvGet(key: any): Promise<any>;
	kvGetBatch(key: any[]): Promise<[any, any][]>;
	kvPut(key: any, value: any): Promise<void>;
	kvPutBatch(key: [any, any][]): Promise<void>;
	kvDelete(key: any): Promise<void>;
	kvDeleteBatch(key: any[]): Promise<void>;

	// Schedule
	setAlarm(timestamp: number): Promise<void>;

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
