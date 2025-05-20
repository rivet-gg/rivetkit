import {
	runDriverTests,
	createTestRuntime,
} from "@/driver-test-suite/mod";
import { TestGlobalState } from "@/test/driver/global-state";
import { TestActorDriver } from "@/test/driver/actor";
import { TestManagerDriver } from "@/test/driver/manager";

runDriverTests({
	async start(appPath: string) {
		return await createTestRuntime(appPath, async (app) => {
			const memoryState = new TestGlobalState();
			return {
				actorDriver: new TestActorDriver(memoryState),
				managerDriver: new TestManagerDriver(app, memoryState),
			};
		});
	},
});
