import { Hono, type Context as HonoContext } from "hono";
import { EncodingSchema } from "@/actor/protocol/serde";
import {
	type ActionOpts,
	type ActionOutput,
	type ConnectionHandlers,
	type ConnectSseOpts,
	type ConnectSseOutput,
	type ConnectWebSocketOpts,
	type ConnectWebSocketOutput,
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
import { noopNext } from "@/common/utils";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
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

	router.get("/connect/websocket", async (c) => {
		const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
		if (upgradeWebSocket) {
			return upgradeWebSocket(async (c) => {
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
			})(c, noopNext());
		} else {
			return c.text(
				"WebSockets are not enabled for this driver. Use SSE instead.",
				400,
			);
		}
	});

	router.get("/connect/sse", async (c) => {
		if (!handlers.onConnectSse) {
			throw new Error("onConnectSse handler is required");
		}
		const actorId = await handler.getActorId();

		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown;
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
		let authData: unknown;
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

	// Raw HTTP endpoints - /http/*
	router.all("/http/*", async (c) => {
		const actorId = await handler.getActorId();
		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown;
		if (authDataRaw) {
			authData = JSON.parse(authDataRaw);
		}

		// Get the actor instance to handle raw HTTP
		if (!handlers.onFetch) {
			return c.text("Not Found", 404);
		}

		return handlers.onFetch({
			actorId,
			authData,
			request: c.req.raw,
		});
	});

	// Raw WebSocket endpoint - /websocket/*
	router.get("/websocket/*", async (c) => {
		const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
		if (upgradeWebSocket) {
			return upgradeWebSocket(async (ws: any) => {
				const actorId = await handler.getActorId();
				const authDataRaw = c.req.header(HEADER_AUTH_DATA);
				let authData: unknown;
				if (authDataRaw) {
					authData = JSON.parse(authDataRaw);
				}

				if (!handlers.onWebSocket) {
					throw new Error("onWebSocket handler not implemented");
				}

				await handlers.onWebSocket({
					actorId,
					authData,
					request: c.req.raw,
					websocket: ws,
				});
			})(c, noopNext());
		} else {
			return c.text(
				"WebSockets are not enabled for this driver. Use SSE instead.",
				400,
			);
		}
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
