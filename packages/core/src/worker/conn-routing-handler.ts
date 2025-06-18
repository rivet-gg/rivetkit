import type { UpgradeWebSocket } from "@/utils";
import type { Encoding } from "./protocol/serde";
import type { ConnectionHandlers as ConnHandlers } from "./router-endpoints";
import type { Context as HonoContext } from "hono";
import type { WebSocket } from "ws";

/**
 * Deterines how requests to workers should be routed.
 *
 * Inline handlers calls the connection handlers directly.
 *
 * Custom will let a custom function handle the request. This usually will proxy the request to another location.
 */
export type ConnRoutingHandler =
	| {
			inline: {
				handlers: ConnHandlers;
			};
	  }
	| {
			custom: ConnRoutingHandlerCustom;
	  };

export interface ConnRoutingHandlerCustom {
	sendRequest: SendRequestHandler;
	openWebSocket: OpenWebSocketHandler;
	proxyRequest: ProxyRequestHandler;
	proxyWebSocket: ProxyWebSocketHandler;
}

export type BuildProxyEndpoint = (c: HonoContext, workerId: string) => string;

export type SendRequestHandler = (
	workerId: string,
	workerRequest: Request,
) => Promise<Response>;

export type OpenWebSocketHandler = (
	workerId: string,
	encodingKind: Encoding,
	params: unknown
) => Promise<WebSocket>;

export type ProxyRequestHandler = (
	c: HonoContext,
	workerRequest: Request,
	workerId: string,
) => Promise<Response>;

export type ProxyWebSocketHandler = (
	c: HonoContext,
	path: string,
	workerId: string,
	encoding: Encoding,
	connParams: unknown,
	authData: unknown,
	upgradeWebSocket: UpgradeWebSocket,
) => Promise<Response>;
