import { setup } from "@rivetkit/core";

// Import actors from individual files
import { counter } from "./counter";
import { counterWithLifecycle } from "./lifecycle";
import { scheduled } from "./scheduled";
import { errorHandlingActor, customTimeoutActor } from "./error-handling";
import { inputActor } from "./action-inputs";
import {
	shortTimeoutActor,
	longTimeoutActor,
	defaultTimeoutActor,
	syncTimeoutActor,
} from "./action-timeout";
import {
	syncActionActor,
	asyncActionActor,
	promiseActor,
} from "./action-types";
import { counterWithParams } from "./conn-params";
import { connStateActor } from "./conn-state";
import { metadataActor } from "./metadata";
import {
	staticVarActor,
	nestedVarActor,
	dynamicVarActor,
	uniqueVarActor,
	driverCtxActor,
} from "./vars";
import {
	authActor,
	intentAuthActor,
	publicActor,
	noAuthActor,
	asyncAuthActor,
} from "./auth";

// Consolidated setup with all actors
export const registry = setup({
	actors: {
		// From counter.ts
		counter,
		// From lifecycle.ts
		counterWithLifecycle,
		// From scheduled.ts
		scheduled,
		// From error-handling.ts
		errorHandlingActor,
		customTimeoutActor,
		// From action-inputs.ts
		inputActor,
		// From action-timeout.ts
		shortTimeoutActor,
		longTimeoutActor,
		defaultTimeoutActor,
		syncTimeoutActor,
		// From action-types.ts
		syncActionActor,
		asyncActionActor,
		promiseActor,
		// From conn-params.ts
		counterWithParams,
		// From conn-state.ts
		connStateActor,
		// From metadata.ts
		metadataActor,
		// From vars.ts
		staticVarActor,
		nestedVarActor,
		dynamicVarActor,
		uniqueVarActor,
		driverCtxActor,
		// From auth.ts
		authActor,
		intentAuthActor,
		publicActor,
		noAuthActor,
		asyncAuthActor,
	},
});

export type Registry = typeof registry;
