import { setup } from "rivetkit";

// Import workers from individual files
import { counter } from "./counter";
import { counterWithLifecycle } from "./lifecycle";
import { scheduled } from "./scheduled";
import { errorHandlingWorker, customTimeoutWorker } from "./error-handling";
import { inputWorker } from "./action-inputs";
import {
	shortTimeoutWorker,
	longTimeoutWorker,
	defaultTimeoutWorker,
	syncTimeoutWorker,
} from "./action-timeout";
import {
	syncActionWorker,
	asyncActionWorker,
	promiseWorker,
} from "./action-types";
import { counterWithParams } from "./conn-params";
import { connStateWorker } from "./conn-state";
import { metadataWorker } from "./metadata";
import {
	staticVarWorker,
	nestedVarWorker,
	dynamicVarWorker,
	uniqueVarWorker,
	driverCtxWorker,
} from "./vars";
import {
	authWorker,
	intentAuthWorker,
	publicWorker,
	noAuthWorker,
	asyncAuthWorker,
} from "./auth";

// Consolidated setup with all workers
export const registry = setup({
	workers: {
		// From counter.ts
		counter,
		// From lifecycle.ts
		counterWithLifecycle,
		// From scheduled.ts
		scheduled,
		// From error-handling.ts
		errorHandlingWorker,
		customTimeoutWorker,
		// From action-inputs.ts
		inputWorker,
		// From action-timeout.ts
		shortTimeoutWorker,
		longTimeoutWorker,
		defaultTimeoutWorker,
		syncTimeoutWorker,
		// From action-types.ts
		syncActionWorker,
		asyncActionWorker,
		promiseWorker,
		// From conn-params.ts
		counterWithParams,
		// From conn-state.ts
		connStateWorker,
		// From metadata.ts
		metadataWorker,
		// From vars.ts
		staticVarWorker,
		nestedVarWorker,
		dynamicVarWorker,
		uniqueVarWorker,
		driverCtxWorker,
		// From auth.ts
		authWorker,
		intentAuthWorker,
		publicWorker,
		noAuthWorker,
		asyncAuthWorker,
	},
});

export type Registry = typeof registry;
