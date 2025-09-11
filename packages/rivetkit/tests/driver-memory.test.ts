import { join } from "node:path";
import { createTestRuntime, runDriverTests } from "@/driver-test-suite/mod";
import { createFileSystemOrMemoryDriver } from "@/drivers/file-system/mod";

runDriverTests({
	// TODO: Remove this once timer issues are fixed in actor-sleep.ts
	useRealTimers: true,
	async start(projectPath: string) {
		return await createTestRuntime(
			join(projectPath, "registry.ts"),
			async () => {
				return {
					driver: createFileSystemOrMemoryDriver(false),
				};
			},
		);
	},
});
