import { describe } from "vitest";
import type { DriverTestConfig } from "../mod";
import { runActorScheduleTests } from "./actor-schedule";
import { runActorStateTests } from "./actor-state";

export function runActorDriverTests(driverTestConfig: DriverTestConfig) {
	describe("Actor Driver Tests", () => {
		// Run state persistence tests
		runActorStateTests(driverTestConfig);

		// Run scheduled alarms tests
		runActorScheduleTests(driverTestConfig);
	});
}
