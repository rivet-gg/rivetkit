import {
	runDriverTests,
	createTestRuntime,
} from "rivetkit/driver-test-suite";
import {
	FileSystemWorkerDriver,
	FileSystemManagerDriver,
	FileSystemGlobalState,
} from "../src/mod";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

runDriverTests({
	async start(appPath: string) {
		return await createTestRuntime(appPath, async (registry) => {
			// Create a unique temp directory for each test
			const testDir = path.join(
				os.tmpdir(),
				`rivetkit-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
			);
			await fs.mkdir(testDir, { recursive: true });

			const fileSystemState = new FileSystemGlobalState(testDir);
			return {
				workerDriver: new FileSystemWorkerDriver(fileSystemState),
				managerDriver: new FileSystemManagerDriver(registry, fileSystemState),
				async cleanup() {
					await fs.rmdir(testDir, { recursive: true });

				}
			};
		});
	},
});
