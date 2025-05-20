import { resolve } from "node:path";

export type { App as CounterApp } from "../../fixtures/driver-test-suite/counter";
export type { App as ScheduledApp } from "../../fixtures/driver-test-suite/scheduled";

export const COUNTER_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/counter.ts",
);
export const SCHEDULED_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/scheduled.ts",
);
