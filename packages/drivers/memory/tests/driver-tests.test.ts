import { runDriverTests, createTestRuntime } from "rivetkit/driver-test-suite";
import {
	MemoryWorkerDriver,
	MemoryManagerDriver,
	MemoryGlobalState,
} from "../src/mod";

runDriverTests({
	async start(appPath: string) {
		return await createTestRuntime(appPath, async (registry) => {
			const memoryState = new MemoryGlobalState();
			return {
				workerDriver: new MemoryWorkerDriver(memoryState),
				managerDriver: new MemoryManagerDriver(registry, memoryState),
			};
		});
	},
});
