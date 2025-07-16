import { setup } from "@rivetkit/core";

import { inputActor } from "./action-inputs";
import {
	defaultTimeoutActor,
	longTimeoutActor,
	shortTimeoutActor,
	syncTimeoutActor,
} from "./action-timeout";
import {
	asyncActionActor,
	promiseActor,
	syncActionActor,
} from "./action-types";
import {
	asyncAuthActor,
	authActor,
	intentAuthActor,
	noAuthActor,
	publicActor,
} from "./auth";
import { counterWithParams } from "./conn-params";
import { connStateActor } from "./conn-state";
// Import actors from individual files
import { counter } from "./counter";
import { customTimeoutActor, errorHandlingActor } from "./error-handling";
import { inlineClientActor } from "./inline-client";
import { counterWithLifecycle } from "./lifecycle";
import { metadataActor } from "./metadata";
import {
	rawHttpActor,
	rawHttpHonoActor,
	rawHttpNoHandlerActor,
	rawHttpVoidReturnActor,
} from "./raw-http";
import {
	rawHttpAuthActor,
	rawHttpCustomAuthActor,
	rawHttpNoAuthActor,
	rawHttpPublicActor,
} from "./raw-http-auth";
import { rawHttpRequestPropertiesActor } from "./raw-http-request-properties";
import { rawWebSocketActor, rawWebSocketBinaryActor } from "./raw-websocket";
import {
	rawWebSocketAuthActor,
	rawWebSocketCustomAuthActor,
	rawWebSocketNoAuthActor,
	rawWebSocketPublicActor,
} from "./raw-websocket-auth";
import { scheduled } from "./scheduled";
import {
	driverCtxActor,
	dynamicVarActor,
	nestedVarActor,
	staticVarActor,
	uniqueVarActor,
} from "./vars";

// Consolidated setup with all actors
export const registry = setup({
	use: {
		// From counter.ts
		counter,
		// From lifecycle.ts
		counterWithLifecycle,
		// From scheduled.ts
		scheduled,
		// From error-handling.ts
		errorHandlingActor,
		customTimeoutActor,
		// From inline-client.ts
		inlineClientActor,
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
		// From raw-http.ts
		rawHttpActor,
		rawHttpNoHandlerActor,
		rawHttpVoidReturnActor,
		rawHttpHonoActor,
		// From raw-http-auth.ts
		rawHttpAuthActor,
		rawHttpNoAuthActor,
		rawHttpPublicActor,
		rawHttpCustomAuthActor,
		// From raw-http-request-properties.ts
		rawHttpRequestPropertiesActor,
		// From raw-websocket.ts
		rawWebSocketActor,
		rawWebSocketBinaryActor,
		// From raw-websocket-auth.ts
		rawWebSocketAuthActor,
		rawWebSocketNoAuthActor,
		rawWebSocketPublicActor,
		rawWebSocketCustomAuthActor,
	},
});
