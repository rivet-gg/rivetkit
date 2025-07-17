import type { DriverConfig } from "@/registry/run-config";
import { FileSystemActorDriver } from "./actor";
import { FileSystemGlobalState } from "./global-state";
import { FileSystemManagerDriver } from "./manager";

export { FileSystemActorDriver } from "./actor";
export { FileSystemGlobalState } from "./global-state";
export { FileSystemManagerDriver } from "./manager";
export { getStoragePath } from "./utils";

export function createFileSystemDriver(
	persist: boolean = true,
	customPath?: string,
): DriverConfig {
	const state = new FileSystemGlobalState(persist, customPath);
	return {
		manager: (registryConfig, runConfig) =>
			new FileSystemManagerDriver(registryConfig, runConfig, state),
		actor: (registryConfig, runConfig, managerDriver, inlineClient) =>
			new FileSystemActorDriver(
				registryConfig,
				runConfig,
				managerDriver,
				inlineClient,
				state,
			),
	};
}
