import type { DriverConfig } from "rivetkit";
import { MemoryManagerDriver } from "./manager";
import { MemoryGlobalState } from "./global-state";
import { MemoryWorkerDriver } from "./worker";

export function createMemoryDriver(): DriverConfig {
	const state = new MemoryGlobalState();
	return {
		topology: "standalone",
		manager: new MemoryManagerDriver(state),
		worker: new MemoryWorkerDriver(state),
	};
}
