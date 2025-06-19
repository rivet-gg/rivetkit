import { MemoryGlobalState } from "@/global-state";
import { createMemoryDriver } from "@/mod";
import { runDriverTests, createTestRuntime } from "rivetkit/driver-test-suite";

runDriverTests({
	async start(appPath: string) {
		return await createTestRuntime(appPath, async () => {
			return {
				driver: createMemoryDriver(),
			};
		});
	},
});
