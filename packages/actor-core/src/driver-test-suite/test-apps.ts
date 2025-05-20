import { resolve } from "node:path";

export type { App as CounterApp } from "../../fixtures/driver-test-suite/counter";
export type { App as ScheduledApp } from "../../fixtures/driver-test-suite/scheduled";
export type { App as ConnParamsApp } from "../../fixtures/driver-test-suite/conn-params";
export type { App as LifecycleApp } from "../../fixtures/driver-test-suite/lifecycle";

export const COUNTER_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/counter.ts",
);
export const SCHEDULED_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/scheduled.ts",
);
export const CONN_PARAMS_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/conn-params.ts",
);
export const LIFECYCLE_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/lifecycle.ts",
);