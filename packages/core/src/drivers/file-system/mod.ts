import type { DriverConfig } from "@/registry/run-config";
import { FileSystemActorDriver } from "./actor";
import { FileSystemGlobalState } from "./global-state";
import { FileSystemManagerDriver } from "./manager";

export { FileSystemActorDriver } from "./actor";
export { FileSystemGlobalState } from "./global-state";
export { FileSystemManagerDriver } from "./manager";
export { getStoragePath } from "./utils";

export function createFileSystemDriver(): DriverConfig {
	const state = new FileSystemGlobalState();
	return {
		topology: "standalone",
		manager: new FileSystemManagerDriver(state),
		actor: new FileSystemActorDriver(state),
	};
}
