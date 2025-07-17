import type { Context as HonoContext } from "hono";
import type { UpgradeWebSocket } from "@/utils";
import type { AnyActorInstance } from "./instance";
import type { Encoding } from "./protocol/serde";
import type { ConnectionHandlers as ConnHandlers } from "./router-endpoints";

/**
 * Deterines how requests to actors should be routed.
 *
 * Inline handlers calls the connection handlers directly.
 *
 * Custom will let a custom function handle the request. This usually will proxy the request to another location.
 */
export type ConnRoutingHandler =
	| {
			inline: {
				handlers: ConnHandlers;
				getActorInstance?: (
					actorId: string,
				) => Promise<AnyActorInstance | undefined>;
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

export type BuildProxyEndpoint = (c: HonoContext, actorId: string) => string;

export type SendRequestHandler = (
	actorId: string,
	actorRequest: Request,
) => Promise<Response>;

export type OpenWebSocketHandler = (
	actorId: string,
	encodingKind: Encoding,
	params: unknown,
) => Promise<WebSocket>;

export type ProxyRequestHandler = (
	c: HonoContext,
	actorRequest: Request,
	actorId: string,
) => Promise<Response>;

export type ProxyWebSocketHandler = (
	c: HonoContext,
	path: string,
	actorId: string,
	encoding: Encoding,
	connParams: unknown,
	authData: unknown,
	upgradeWebSocket: UpgradeWebSocket,
) => Promise<Response>;
