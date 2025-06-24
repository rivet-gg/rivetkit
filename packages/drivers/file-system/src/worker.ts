import type { WorkerDriver, AnyWorkerInstance } from "@rivetkit/core/driver-helpers";
import type { FileSystemGlobalState } from "./global-state";

export type WorkerDriverContext = Record<never, never>;

/**
 * File System implementation of the Worker Driver
 */
export class FileSystemWorkerDriver implements WorkerDriver {
    #state: FileSystemGlobalState;
    
    constructor(state: FileSystemGlobalState) {
        this.#state = state;
    }
    
    /**
     * Get the current storage directory path
     */
    get storagePath(): string {
        return this.#state.storagePath;
    }

    getContext(_workerId: string): WorkerDriverContext {
        return {};
    }

	async readInput(workerId: string): Promise<unknown | undefined> {
	    return this.#state.readInput(workerId);
	}

    async readPersistedData(workerId: string): Promise<unknown | undefined> {
        return this.#state.readPersistedData(workerId);
    }

    async writePersistedData(workerId: string, data: unknown): Promise<void> {
        this.#state.writePersistedData(workerId, data);
        
        // Save state to disk
        await this.#state.saveWorkerState(workerId);
    }

    async setAlarm(worker: AnyWorkerInstance, timestamp: number): Promise<void> {
        const delay = Math.max(0, timestamp - Date.now());
        setTimeout(() => {
            worker.onAlarm();
        }, delay);
    }
}
