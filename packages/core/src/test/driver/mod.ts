import type { DriverConfig } from "@/mod";
import { TestActorDriver } from "./actor";
import { TestGlobalState } from "./global-state";
import { TestManagerDriver } from "./manager";

export { TestGlobalState } from "./global-state";
export { TestActorDriver } from "./actor";
export { TestManagerDriver } from "./manager";

export function createTestDriver(): DriverConfig {
	const state = new TestGlobalState();
	return {
		topology: "standalone",
		manager: new TestManagerDriver(state),
		actor: new TestActorDriver(state),
	};
}
