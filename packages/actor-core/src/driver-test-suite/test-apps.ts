import { resolve } from "node:path";

export type { App as CounterApp } from "../../fixtures/driver-test-suite/counter";
export type { App as ScheduledApp } from "../../fixtures/driver-test-suite/scheduled";
export type { App as ConnParamsApp } from "../../fixtures/driver-test-suite/conn-params";
export type { App as LifecycleApp } from "../../fixtures/driver-test-suite/lifecycle";
export type { App as ActionTimeoutApp } from "../../fixtures/driver-test-suite/action-timeout";
export type { App as ActionTypesApp } from "../../fixtures/driver-test-suite/action-types";
export type { App as VarsApp } from "../../fixtures/driver-test-suite/vars";
export type { App as ConnStateApp } from "../../fixtures/driver-test-suite/conn-state";
export type { App as MetadataApp } from "../../fixtures/driver-test-suite/metadata";
export type { App as ErrorHandlingApp } from "../../fixtures/driver-test-suite/error-handling";
export type { App as ActionInputsApp } from "../../fixtures/driver-test-suite/action-inputs";

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
export const ACTION_TIMEOUT_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/action-timeout.ts",
);
export const ACTION_TYPES_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/action-types.ts",
);
export const VARS_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/vars.ts",
);
export const CONN_STATE_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/conn-state.ts",
);
export const METADATA_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/metadata.ts",
);
export const ERROR_HANDLING_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/error-handling.ts",
);
export const ACTION_INPUTS_APP_PATH = resolve(
	__dirname,
	"../../fixtures/driver-test-suite/action-inputs.ts",
);