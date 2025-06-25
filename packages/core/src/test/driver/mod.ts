import { DriverConfig } from "@/mod";
import { TestGlobalState } from "./global-state";
import { TestManagerDriver } from "./manager";
import { TestActorDriver } from  "./actor";

export { TestGlobalState } from "./global-state";
export { TestActorDriver } from  "./actor";
export { TestManagerDriver } from "./manager";

export function createTestDriver(): DriverConfig {
	const state = new TestGlobalState();
	return {
		topology: "standalone",
		manager: new TestManagerDriver(state),
		actor: new TestActorDriver(state),
	};
}
