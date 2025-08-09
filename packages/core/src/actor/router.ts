import { Hono, type Context as HonoContext } from "hono";
import invariant from "invariant";
import {
	EncodingSchema,
	SubscriptionsListSchema,
} from "@/actor/protocol/serde";
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
	HEADER_CONN_SUBS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
	handleAction,
	handleConnectionMessage,
	handleRawWebSocketHandler,
	handleSseConnect,
	handleWebSocketConnect,
} from "@/actor/router-endpoints";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import { noopNext } from "@/common/utils";
import {
	type ActorInspectorRouterEnv,
	createActorInspectorRouter,
} from "@/inspector/actor";
import { secureInspector } from "@/inspector/utils";
import type { RunConfig } from "@/registry/run-config";
import type { ActorDriver } from "./driver";
import { InternalError } from "./errors";
import { logger } from "./log";

export const PATH_CONNECT_WEBSOCKET = "/connect/websocket";
export const PATH_RAW_WEBSOCKET_PREFIX = "/raw/websocket/";

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

	router.get(PATH_CONNECT_WEBSOCKET, async (c) => {
		const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
		if (upgradeWebSocket) {
			return upgradeWebSocket(async (c) => {
				const encodingRaw = c.req.header(HEADER_ENCODING);
				const connParamsRaw = c.req.header(HEADER_CONN_PARAMS);
				const authDataRaw = c.req.header(HEADER_AUTH_DATA);
				const subsRaw = c.req.header(HEADER_CONN_SUBS);

				const encoding = EncodingSchema.parse(encodingRaw);
				const connParams = connParamsRaw
					? JSON.parse(connParamsRaw)
					: undefined;
				const authData = authDataRaw ? JSON.parse(authDataRaw) : undefined;
				const subs = subsRaw
					? SubscriptionsListSchema.parse(JSON.parse(subsRaw))
					: [];

				return await handleWebSocketConnect(
					c as HonoContext,
					runConfig,
					actorDriver,
					c.env.actorId,
					encoding,
					connParams,
					subs,
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
		const subsRaw = c.req.header(HEADER_CONN_SUBS);

		const subscriptions = subsRaw
			? SubscriptionsListSchema.parse(JSON.parse(subsRaw))
			: [];

		return handleSseConnect(
			c,
			runConfig,
			actorDriver,
			c.env.actorId,
			subscriptions,
			authData,
		);
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
	router.get(`${PATH_RAW_WEBSOCKET_PREFIX}*`, async (c) => {
		const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
		if (upgradeWebSocket) {
			return upgradeWebSocket(async (c) => {
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

				return await handleRawWebSocketHandler(
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

	if (runConfig.studio.enabled) {
		router.route(
			"/inspect",
			new Hono<ActorInspectorRouterEnv & { Bindings: ActorRouterBindings }>()
				.use(secureInspector(runConfig), async (c, next) => {
					const inspector = (await actorDriver.loadActor(c.env.actorId))
						.inspector;
					invariant(inspector, "inspector not supported on this platform");

					c.set("inspector", inspector);
					await next();
				})
				.route("/", createActorInspectorRouter()),
		);
	}

	router.notFound(handleRouteNotFound);
	router.onError(
		handleRouteError.bind(undefined, {
			// All headers to this endpoint are considered secure, so we can enable the expose internal error header for requests from the internal client
			enableExposeInternalError: true,
		}),
	);

	return router;
}
