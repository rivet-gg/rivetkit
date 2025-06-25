import { EncodingSchema } from "@/actor/protocol/serde";
import {
	type ActionOpts,
	type ActionOutput,
	type ConnectSseOpts,
	type ConnectSseOutput,
	type ConnectWebSocketOpts,
	type ConnectWebSocketOutput,
	type ConnectionHandlers,
	type ConnsMessageOpts,
	HEADER_AUTH_DATA,
	HEADER_CONN_ID,
	HEADER_CONN_PARAMS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
	handleAction,
	handleConnectionMessage,
	handleSseConnect,
	handleWebSocketConnect,
} from "@/actor/router-endpoints";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import { Hono, type Context as HonoContext } from "hono";
import { logger } from "./log";

export type {
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
	ConnectSseOpts,
	ConnectSseOutput,
	ActionOpts,
	ActionOutput,
	ConnsMessageOpts,
};

export interface ActorRouterHandler {
	getActorId: () => Promise<string>;

	// Connection handlers as a required subobject
	connectionHandlers: ConnectionHandlers;

	// onConnectInspector?: ActorInspectorConnHandler;
}

/**
 * Creates a router that runs on the partitioned instance.
 */
export function createActorRouter(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	handler: ActorRouterHandler,
): Hono {
	const router = new Hono({ strict: false });

	const upgradeWebSocket = runConfig.getUpgradeWebSocket?.(router);

	router.use("*", loggerMiddleware(logger()));

	router.get("/", (c) => {
		return c.text(
			"This is an RivetKit server.\n\nLearn more at https://rivetkit.org",
		);
	});

	router.get("/health", (c) => {
		return c.text("ok");
	});

	// Use the handlers from connectionHandlers
	const handlers = handler.connectionHandlers;

	if (upgradeWebSocket) {
		router.get(
			"/connect/websocket",
			upgradeWebSocket(async (c) => {
				const actorId = await handler.getActorId();
				const encodingRaw = c.req.header(HEADER_ENCODING);
				const connParamsRaw = c.req.header(HEADER_CONN_PARAMS);
				const authDataRaw = c.req.header(HEADER_AUTH_DATA);

				const encoding = EncodingSchema.parse(encodingRaw);
				const connParams = connParamsRaw
					? JSON.parse(connParamsRaw)
					: undefined;
				const authData = authDataRaw ? JSON.parse(authDataRaw) : undefined;

				return handleWebSocketConnect(
					c as HonoContext,
					registryConfig,
					runConfig,
					handlers.onConnectWebSocket!,
					actorId,
					encoding,
					connParams,
					authData,
				);
			}),
		);
	} else {
		router.get("/connect/websocket", (c) => {
			return c.text(
				"WebSockets are not enabled for this driver. Use SSE instead.",
				400,
			);
		});
	}

	router.get("/connect/sse", async (c) => {
		if (!handlers.onConnectSse) {
			throw new Error("onConnectSse handler is required");
		}
		const actorId = await handler.getActorId();

		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown = undefined;
		if (authDataRaw) {
			authData = JSON.parse(authDataRaw);
		}

		return handleSseConnect(
			c,
			registryConfig,
			runConfig,
			handlers.onConnectSse,
			actorId,
			authData,
		);
	});

	router.post("/action/:action", async (c) => {
		if (!handlers.onAction) {
			throw new Error("onAction handler is required");
		}
		const actionName = c.req.param("action");
		const actorId = await handler.getActorId();

		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown = undefined;
		if (authDataRaw) {
			authData = JSON.parse(authDataRaw);
		}

		return handleAction(
			c,
			registryConfig,
			runConfig,
			handlers.onAction,
			actionName,
			actorId,
			authData,
		);
	});

	router.post("/connections/message", async (c) => {
		if (!handlers.onConnMessage) {
			throw new Error("onConnMessage handler is required");
		}
		const connId = c.req.header(HEADER_CONN_ID);
		const connToken = c.req.header(HEADER_CONN_TOKEN);
		const actorId = await handler.getActorId();
		if (!connId || !connToken) {
			throw new Error("Missing required parameters");
		}
		return handleConnectionMessage(
			c,
			registryConfig,
			runConfig,
			handlers.onConnMessage,
			connId,
			connToken,
			actorId,
		);
	});

	// if (registryConfig.inspector.enabled) {
	// 	router.route(
	// 		"/inspect",
	// 		createActorInspectorRouter(
	// 			upgradeWebSocket,
	// 			handler.onConnectInspector,
	// 			registryConfig.inspector,
	// 		),
	// 	);
	// }

	router.notFound(handleRouteNotFound);
	router.onError(
		handleRouteError.bind(undefined, {
			// All headers to this endpoint are considered secure, so we can enable the expose internal error header for requests from the internal client
			enableExposeInternalError: true,
		}),
	);

	return router;
}
