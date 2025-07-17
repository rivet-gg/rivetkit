import type * as messageToClient from "@/actor/protocol/message/to-client";
import type { CachedSerializer } from "@/actor/protocol/serde";
import type { AnyClient } from "@/client/client";
import type { ManagerDriver } from "@/manager/driver";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import type { AnyConn } from "./connection";
import type { GenericConnGlobalState } from "./generic-conn-driver";
import type { AnyActorInstance } from "./instance";

export type ConnDrivers = Record<string, ConnDriver>;

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
