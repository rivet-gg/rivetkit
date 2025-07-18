import { Hono, type Context as HonoContext } from "hono";
import { EncodingSchema } from "@/actor/protocol/serde";
import {
	type ActionOpts,
	type ActionOutput,
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
	handleRawWebSocketHandler,
	handleSseConnect,
	handleWebSocketConnect,
} from "@/actor/router-endpoints";
import { AnyClient } from "@/client/client";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import { noopNext } from "@/common/utils";
import { ManagerDriver } from "@/manager/driver";
import { RegistryConfig } from "@/mod";
import type { RunConfig } from "@/registry/run-config";
import { dbg } from "@/utils";
import type { ActorDriver } from "./driver";
import { InternalError } from "./errors";
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

interface ActorRouterBindings {
	actorId: string;
}

export type ActorRouter = Hono<{ Bindings: ActorRouterBindings }>;

/**
 * Creates a router that runs on the partitioned instance.
 */
export function createActorRouter(
	runConfig: RunConfig,
	actorDriver: ActorDriver,
): ActorRouter {
	const router = new Hono<{ Bindings: ActorRouterBindings }>({ strict: false });

	router.use("*", loggerMiddleware(logger()));

	router.get("/", (c) => {
		return c.text(
			"This is an RivetKit actor.\n\nLearn more at https://rivetkit.org",
		);
	});

	router.get("/health", (c) => {
		return c.text("ok");
	});

	router.get("/connect/websocket", async (c) => {
		const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
		if (upgradeWebSocket) {
			return upgradeWebSocket((c) => {
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
					runConfig,
					actorDriver,
					c.env.actorId,
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
		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown;
		if (authDataRaw) {
			authData = JSON.parse(authDataRaw);
		}

		return handleSseConnect(c, runConfig, actorDriver, c.env.actorId, authData);
	});

	router.post("/action/:action", async (c) => {
		const actionName = c.req.param("action");

		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown;
		if (authDataRaw) {
			authData = JSON.parse(authDataRaw);
		}

		return handleAction(
			c,
			runConfig,
			actorDriver,
			actionName,
			c.env.actorId,
			authData,
		);
	});

	router.post("/connections/message", async (c) => {
		const connId = c.req.header(HEADER_CONN_ID);
		const connToken = c.req.header(HEADER_CONN_TOKEN);
		if (!connId || !connToken) {
			throw new Error("Missing required parameters");
		}
		return handleConnectionMessage(
			c,
			runConfig,
			actorDriver,
			connId,
			connToken,
			c.env.actorId,
		);
	});

	// Raw HTTP endpoints - /http/*
	router.all("/raw/http/*", async (c) => {
		const authDataRaw = c.req.header(HEADER_AUTH_DATA);
		let authData: unknown;
		if (authDataRaw) {
			authData = JSON.parse(authDataRaw);
		}

		const actor = await actorDriver.loadActor(c.env.actorId);

		// TODO: This is not a clean way of doing this since `/http/` might exist mid-path
		// Strip the /http prefix from the URL to get the original path
		const url = new URL(c.req.url);
		const originalPath = url.pathname.replace(/^\/raw\/http/, "") || "/";

		// Create a new request with the corrected URL
		const correctedUrl = new URL(originalPath + url.search, url.origin);
		const correctedRequest = new Request(correctedUrl, {
			method: c.req.method,
			headers: c.req.raw.headers,
			body: c.req.raw.body,
		});

		logger().debug("rewriting http url", {
			from: c.req.url,
			to: correctedRequest.url,
		});

		// Call the actor's onFetch handler - it will throw appropriate errors
		const response = await actor.handleFetch(correctedRequest, {
			auth: authData,
		});

		// This should never happen now since handleFetch throws errors
		if (!response) {
			throw new InternalError("handleFetch returned void unexpectedly");
		}

		return response;
	});

	// Raw WebSocket endpoint - /websocket/*
	router.get("/raw/websocket/*", async (c) => {
		const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
		if (upgradeWebSocket) {
			return upgradeWebSocket((c) => {
				const encodingRaw = c.req.header(HEADER_ENCODING);
				const connParamsRaw = c.req.header(HEADER_CONN_PARAMS);
				const authDataRaw = c.req.header(HEADER_AUTH_DATA);

				const encoding = EncodingSchema.parse(encodingRaw);
				const connParams = connParamsRaw
					? JSON.parse(connParamsRaw)
					: undefined;
				const authData = authDataRaw ? JSON.parse(authDataRaw) : undefined;

				const url = new URL(c.req.url);
				const pathWithQuery = c.req.path + url.search;

				logger().debug("actor router raw websocket", {
					path: c.req.path,
					url: c.req.url,
					search: url.search,
					pathWithQuery,
				});

				return handleRawWebSocketHandler(
					c,
					pathWithQuery,
					actorDriver,
					c.env.actorId,
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
