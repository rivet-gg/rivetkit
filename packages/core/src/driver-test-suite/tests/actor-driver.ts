import { describe } from "vitest";
import type { DriverTestConfig } from "../mod";
import { runActorStateTests } from  "./actor-state";
import { runActorScheduleTests } from  "./actor-schedule";

export function runActorDriverTests(
  driverTestConfig: DriverTestConfig
) {
  describe("Actor Driver Tests", () => {
    // Run state persistence tests
    runActorStateTests(driverTestConfig);
    
    // Run scheduled alarms tests
    runActorScheduleTests(driverTestConfig);
  });
}
