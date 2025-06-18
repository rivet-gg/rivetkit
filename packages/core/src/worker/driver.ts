import type * as messageToClient from "@/worker/protocol/message/to-client";
import type { CachedSerializer } from "@/worker/protocol/serde";
import type { AnyWorkerInstance } from "./instance";
import { AnyConn } from "./connection";

export type ConnDrivers = Record<string, ConnDriver>;

export interface WorkerDriver {
	//load(): Promise<LoadOutput>;
	getContext(workerId: string): unknown;

	readInput(workerId: string): Promise<unknown | undefined>;

	readPersistedData(workerId: string): Promise<unknown | undefined>;
	writePersistedData(workerId: string, unknown: unknown): Promise<void>;

	// Schedule
	setAlarm(worker: AnyWorkerInstance, timestamp: number): Promise<void>;

	// Database
	/**
	 * @experimental
	 * This is an experimental API that may change in the future.
	 */
	getDatabase(workerId: string): Promise<unknown | undefined>;

	// TODO:
	//destroy(): Promise<void>;
	//readState(): void;
}

export interface ConnDriver<ConnDriverState = unknown> {
	sendMessage?(
		worker: AnyWorkerInstance,
		conn: AnyConn,
		state: ConnDriverState,
		message: CachedSerializer<messageToClient.ToClient>,
	): void;

	/**
	 * This returns a promise since we commonly disconnect at the end of a program, and not waiting will cause the socket to not close cleanly.
	 */
	disconnect(
		worker: AnyWorkerInstance,
		conn: AnyConn,
		state: ConnDriverState,
		reason?: string,
	): Promise<void>;
}
