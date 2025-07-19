import { join } from "node:path";
import { createTestRuntime, runDriverTests } from "@/driver-test-suite/mod";
import { createFileSystemOrMemoryDriver } from "@/drivers/file-system/mod";

runDriverTests({
	async start(projectPath: string) {
		return await createTestRuntime(
			join(projectPath, "registry.ts"),
			async () => {
				return {
					driver: createFileSystemOrMemoryDriver(
						true,
						`/tmp/test-${crypto.randomUUID()}`,
					),
				};
			},
		);
	},
});
