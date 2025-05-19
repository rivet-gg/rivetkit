import { Hono, type Context as HonoContext } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { logger } from "./log";
import { cors } from "hono/cors";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import type { DriverConfig } from "@/driver-helpers/config";
import type { AppConfig } from "@/app/config";
import {
	type ActorInspectorConnHandler,
	createActorInspectorRouter,
} from "@/inspector/actor";
import invariant from "invariant";
import {
	type ConnectWebSocketOpts,
	type ConnectWebSocketOutput,
	type ConnectSseOpts,
	type ConnectSseOutput,
	type RpcOpts,
	type RpcOutput,
	type ConnsMessageOpts,
	type ConnectionHandlers,
	handleWebSocketConnect,
	handleSseConnect,
	handleRpc,
	handleConnectionMessage,
} from "./router-endpoints";

export type {
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
	ConnectSseOpts,
	ConnectSseOutput,
	RpcOpts,
	RpcOutput,
	ConnsMessageOpts,
};

export interface ActorRouterHandler {
	getActorId: () => Promise<string>;

	// Connection handlers as a required subobject
	connectionHandlers: ConnectionHandlers;

	onConnectInspector?: ActorInspectorConnHandler;
}

/**
 * Creates a router that handles requests for the protocol and passes it off to the handler.
 *
 * This allows for creating a universal protocol across all platforms.
 */
export function createActorRouter(
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	handler: ActorRouterHandler,
): Hono {
	const app = new Hono();

	const upgradeWebSocket = driverConfig.getUpgradeWebSocket?.(app);

	app.use("*", loggerMiddleware(logger()));

	// Apply CORS middleware if configured
	//
	//This is only relevant if the actor is exposed directly publicly
	if (appConfig.cors) {
		app.use("*", async (c, next) => {
			const path = c.req.path;

			// Don't apply to WebSocket routes, see https://hono.dev/docs/helpers/websocket#upgradewebsocket
			if (path === "/connect/websocket" || path === "/inspect") {
				return next();
			}

			return cors(appConfig.cors)(c, next);
		});
	}

	app.get("/", (c) => {
		return c.text(
			"This is an ActorCore server.\n\nLearn more at https://actorcore.org",
		);
	});

	app.get("/health", (c) => {
		return c.text("ok");
	});

	// Use the handlers from connectionHandlers
	const handlers = handler.connectionHandlers;

	if (upgradeWebSocket && handlers.onConnectWebSocket) {
		app.get(
			"/connect/websocket",
			upgradeWebSocket(async (c) => {
				const actorId = await handler.getActorId();
				return handleWebSocketConnect(
					c as HonoContext,
					appConfig,
					driverConfig,
					handlers.onConnectWebSocket!,
					actorId,
				)();
			}),
		);
	} else {
		app.get("/connect/websocket", (c) => {
			return c.text(
				"WebSockets are not enabled for this driver. Use SSE instead.",
				400,
			);
		});
	}

	app.get("/connect/sse", async (c) => {
		if (!handlers.onConnectSse) {
			throw new Error("onConnectSse handler is required");
		}
		const actorId = await handler.getActorId();
		return handleSseConnect(
			c,
			appConfig,
			driverConfig,
			handlers.onConnectSse,
			actorId,
		);
	});

	app.post("/rpc/:rpc", async (c) => {
		if (!handlers.onRpc) {
			throw new Error("onRpc handler is required");
		}
		const rpcName = c.req.param("rpc");
		const actorId = await handler.getActorId();
		return handleRpc(
			c,
			appConfig,
			driverConfig,
			handlers.onRpc,
			rpcName,
			actorId,
		);
	});

	app.post("/connections/:conn/message", async (c) => {
		if (!handlers.onConnMessage) {
			throw new Error("onConnMessage handler is required");
		}
		const connId = c.req.param("conn");
		const connToken = c.req.query("connectionToken");
		const actorId = await handler.getActorId();
		if (!connId || !connToken) {
			throw new Error("Missing required parameters");
		}
		return handleConnectionMessage(
			c,
			appConfig,
			handlers.onConnMessage,
			connId,
			connToken,
			actorId,
		);
	});

	if (appConfig.inspector.enabled) {
		app.route(
			"/inspect",
			createActorInspectorRouter(
				upgradeWebSocket,
				handler.onConnectInspector,
				appConfig.inspector,
			),
		);
	}

	app.notFound(handleRouteNotFound);
	app.onError(handleRouteError);

	return app;
}
