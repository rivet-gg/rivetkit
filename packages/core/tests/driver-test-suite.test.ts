import { runDriverTests, createTestRuntime } from "@/driver-test-suite/mod";
import { createTestDriver } from "@/test/driver/mod";
import { join } from "node:path";

runDriverTests({
	async start(projectPath: string) {
		return await createTestRuntime(
			join(projectPath, "registry.ts"),
			async () => {
				return {
					driver: createTestDriver(),
				};
			},
		);
	},
});
