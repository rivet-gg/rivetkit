import type { DriverConfig } from "@/registry/run-config";
import { MemoryActorDriver } from "./actor";
import { MemoryGlobalState } from "./global-state";
import { MemoryManagerDriver } from "./manager";

export function createMemoryDriver(): DriverConfig {
	const state = new MemoryGlobalState();
	return {
		topology: "standalone",
		manager: new MemoryManagerDriver(state),
		actor: new MemoryActorDriver(state),
	};
}
