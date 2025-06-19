import { DriverConfig } from "@/mod";
import { TestGlobalState } from "./global-state";
import { TestManagerDriver } from "./manager";
import { TestWorkerDriver } from "./worker";

export { TestGlobalState } from "./global-state";
export { TestWorkerDriver } from "./worker";
export { TestManagerDriver } from "./manager";

export function createTestDriver(): DriverConfig {
	const state = new TestGlobalState();
	return {
		topology: "standalone",
		manager: new TestManagerDriver(state),
		worker: new TestWorkerDriver(state),
	};
}
