import { MemoryGlobalState } from "@/global-state";
import { createMemoryDriver } from "@/mod";
import { runDriverTests, createTestRuntime } from "@rivetkit/core/driver-test-suite";

runDriverTests({
	async start(appPath: string) {
		return await createTestRuntime(appPath, async () => {
			return {
				driver: createMemoryDriver(),
			};
		});
	},
});
