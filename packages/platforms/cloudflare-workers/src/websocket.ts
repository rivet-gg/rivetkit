// Modified from https://github.com/honojs/hono/blob/40ea0eee58e39b31053a0246c595434f1094ad31/src/adapter/cloudflare-workers/websocket.ts#L17
//
// This version calls the open event by default

import { WSContext, defineWebSocketHelper } from "hono/ws";
import type { UpgradeWebSocket, WSEvents, WSReadyState } from "hono/ws";

// Based on https://github.com/honojs/hono/issues/1153#issuecomment-1767321332
export const upgradeWebSocket: UpgradeWebSocket<
	WebSocket,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	any,
	WSEvents<WebSocket>
> = defineWebSocketHelper(async (c, events) => {
	const upgradeHeader = c.req.header("Upgrade");
	if (upgradeHeader !== "websocket") {
		return;
	}

	const webSocketPair = new WebSocketPair();
	const client: WebSocket = webSocketPair[0];
	const server: WebSocket = webSocketPair[1];

	const wsContext = new WSContext<WebSocket>({
		close: (code, reason) => server.close(code, reason),
		get protocol() {
			return server.protocol;
		},
		raw: server,
		get readyState() {
			return server.readyState as WSReadyState;
		},
		url: server.url ? new URL(server.url) : null,
		send: (source) => server.send(source),
	});

	if (events.onClose) {
		server.addEventListener("close", (evt: CloseEvent) =>
			events.onClose?.(evt, wsContext),
		);
	}
	if (events.onMessage) {
		server.addEventListener("message", (evt: MessageEvent) =>
			events.onMessage?.(evt, wsContext),
		);
	}
	if (events.onError) {
		server.addEventListener("error", (evt: Event) =>
			events.onError?.(evt, wsContext),
		);
	}

	server.accept?.();

	// note: cloudflare actors doesn't support 'open' event, so we call it immediately with a fake event
	//
	// we have to do this after `server.accept() is called`
	events.onOpen?.(new Event("open"), wsContext);

	return new Response(null, {
		status: 101,
		headers: {
			// HACK: Required in order for Cloudflare to not error with "Network connection lost"
			//
			// This bug undocumented. Cannot easily reproduce outside of RivetKit.
			"Sec-WebSocket-Protocol": "rivetkit",
		},
		webSocket: client,
	});
});
