// import type { WorkerDriver, AnyWorkerInstance } from "rivetkit/driver-helpers";
// import invariant from "invariant";
// import { KEYS } from "./worker-handler-do";
//
// interface DurableObjectGlobalState {
// 	ctx: DurableObjectState;
// 	env: unknown;
// }
//
// /**
//  * Cloudflare DO can have multiple DO running within the same global scope.
//  *
//  * This allows for storing the worker context globally and looking it up by ID in `CloudflareWorkersWorkerDriver`.
//  */
// export class CloudflareDurableObjectGlobalState {
// 	// Single map for all worker state
// 	#dos: Map<string, DurableObjectGlobalState> = new Map();
//
// 	getDOState(workerId: string): DurableObjectGlobalState {
// 		const state = this.#dos.get(workerId);
// 		invariant(state !== undefined, "durable object state not in global state");
// 		return state;
// 	}
//
// 	setDOState(workerId: string, state: DurableObjectGlobalState) {
// 		this.#dos.set(workerId, state);
// 	}
// }
//
// export interface WorkerDriverContext {
// 	ctx: DurableObjectState;
// 	env: unknown;
// }
//
// export class CloudflareWorkersWorkerDriver implements WorkerDriver {
// 	#globalState: CloudflareDurableObjectGlobalState;
//
// 	constructor(globalState: CloudflareDurableObjectGlobalState) {
// 		this.#globalState = globalState;
// 	}
//
// 	#getDOCtx(workerId: string) {
// 		return this.#globalState.getDOState(workerId).ctx;
// 	}
//
// 	getContext(workerId: string): WorkerDriverContext {
// 		const state = this.#globalState.getDOState(workerId);
// 		return { ctx: state.ctx, env: state.env };
// 	}
//
// 	async readInput(workerId: string): Promise<unknown | undefined> {
// 		return await this.#getDOCtx(workerId).storage.get(KEYS.INPUT);
// 	}
//
// 	async readPersistedData(workerId: string): Promise<unknown | undefined> {
// 		return await this.#getDOCtx(workerId).storage.get(KEYS.PERSISTED_DATA);
// 	}
//
// 	async writePersistedData(workerId: string, data: unknown): Promise<void> {
// 		await this.#getDOCtx(workerId).storage.put(KEYS.PERSISTED_DATA, data);
// 	}
//
// 	async setAlarm(worker: AnyWorkerInstance, timestamp: number): Promise<void> {
// 		await this.#getDOCtx(worker.id).storage.setAlarm(timestamp);
// 	}
//
// 	async getDatabase(workerId: string): Promise<unknown | undefined> {
// 		return this.#getDOCtx(workerId).storage.sql;
// 	}
// }
