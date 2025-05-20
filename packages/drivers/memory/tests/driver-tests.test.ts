import { runDriverTests, createTestRuntime } from "actor-core/driver-test-suite";
import {
	MemoryActorDriver,
	MemoryManagerDriver,
	MemoryGlobalState,
} from "../src/mod";

runDriverTests({
	async start(appPath: string) {
		return await createTestRuntime(appPath, async (app) => {
			const memoryState = new MemoryGlobalState();
			return {
				actorDriver: new MemoryActorDriver(memoryState),
				managerDriver: new MemoryManagerDriver(app, memoryState),
			};
		});
	},
});
