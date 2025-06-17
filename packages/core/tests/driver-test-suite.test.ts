import { runDriverTests, createTestRuntime } from "@/driver-test-suite/mod";
import { TestGlobalState } from "@/test/driver/global-state";
import { TestWorkerDriver } from "@/test/driver/worker";
import { TestManagerDriver } from "@/test/driver/manager";
import { join } from "node:path";

runDriverTests({
	async start(projectPath: string) {
		return await createTestRuntime(join(projectPath, "registry.ts"), async (registry) => {
			const memoryState = new TestGlobalState();
			return {
				workerDriver: new TestWorkerDriver(memoryState),
				managerDriver: new TestManagerDriver(registry, memoryState),
			};
		});
	},
});
