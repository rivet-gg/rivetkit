import type * as messageToClient from "@/actor/protocol/message/to-client";
import type { CachedSerializer } from "@/actor/protocol/serde";
import type { AnyClient } from "@/client/client";
import type { ManagerDriver } from "@/manager/driver";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import type { AnyConn, ConnectionDriver } from "./connection";
import type { GenericConnGlobalState } from "./generic-conn-driver";
import type { AnyActorInstance } from "./instance";

export type ConnectionDriversMap = Record<ConnectionDriver, ConnDriver>;

export type ActorDriverBuilder = (
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	managerDriver: ManagerDriver,
	inlineClient: AnyClient,
) => ActorDriver;

export interface ActorDriver {
	//load(): Promise<LoadOutput>;

	loadActor(actorId: string): Promise<AnyActorInstance>;

	getGenericConnGlobalState(actorId: string): GenericConnGlobalState;

	getContext(actorId: string): unknown;

	readPersistedData(actorId: string): Promise<Uint8Array | undefined>;
	writePersistedData(actorId: string, data: Uint8Array): Promise<void>;

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

export enum ConnectionReadyState {
	UNKNOWN = -1,
	CONNECTING = 0,
	OPEN = 1,
	CLOSING = 2,
	CLOSED = 3,
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

	/**
	 * Returns the ready state of the connection.
	 * This is used to determine if the connection is ready to send messages, or if the connection is stale.
	 */
	getConnectionReadyState?(
		actor: AnyActorInstance,
		conn: AnyConn,
	): ConnectionReadyState | undefined;
}
