import type { AnyActor } from "@/actor/runtime/actor";
import type { Connection, ConnectionId } from "@/actor/runtime/connection";
import { throttle } from "@/actor/runtime/utils";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import { Hono, type HonoRequest } from "hono";
import * as errors from "@/actor/errors";
import { safeStringify } from "@/common/utils";
import {
	type ToServer,
	ToServerSchema,
} from "@/actor/protocol/inspector/to_server";
import type { ToClient } from "@/actor/protocol/inspector/to_client";

export interface ConnectInspectorOpts {
	req: HonoRequest;
}

export interface ConnectInspectortOutput {
	onOpen: (ws: WSContext) => Promise<void>;
	onMessage: (message: ToServer) => Promise<void>;
	onClose: () => Promise<void>;
}

export type InspectorConnectionHandler = (
	opts: ConnectInspectorOpts,
) => Promise<ConnectInspectortOutput>;

/**
 * Create a router for the inspector.
 * @internal
 */
export function createInspectorRouter(
	upgradeWebSocket: UpgradeWebSocket | undefined,
	onConnect: InspectorConnectionHandler | undefined,
) {
	const app = new Hono();

	if (!upgradeWebSocket || !onConnect) {
		return app.get("/", async (c) => {
			return c.json({
				error: "Inspector disabled. Only aviailable on WebSocket connections.",
			});
		});
	}
	return app.get(
		"/",
		upgradeWebSocket(async (c) => {
			const handler = await onConnect({ req: c.req });
			return {
				onOpen: async (_, ws) => {
					await handler.onOpen(ws);
				},
				onClose: async () => {
					await handler.onClose();
				},
				onMessage: async (event) => {
					try {
						const result = ToServerSchema.parse(
							JSON.parse(event.data.valueOf() as string),
						);
						await handler.onMessage(result);
					} catch (error) {
						throw new errors.MalformedMessage(error);
					}
				},
			};
		}),
	);
}

/**
 * Represents a connection to an actor.
 * @internal
 */
export class InspectorConnection {
	constructor(
		public readonly id: string,
		private readonly ws: WSContext,
	) {}

	send(message: ToClient) {
		try {
			const serialized = safeStringify(message, 128 * 1024 * 1024);
			return this.ws.send(serialized);
		} catch {
			return this.ws.send(
				JSON.stringify({
					type: "error",
					message: "Failed to serialize message due to size constraints.",
				} satisfies ToClient),
			);
		}
	}
}
/**
 * Provides a unified interface for inspecting actor external and internal state.
 */
export class Inspector {
	/**
	 * Inspected actor instance.
	 * @internal
	 */
	readonly actor: AnyActor;

	/**
	 * Map of all connections to the inspector.
	 * @internal
	 */
	readonly #connections = new Map<ConnectionId, InspectorConnection>();

	/**
	 * Connection counter.
	 */
	#conId = 0;

	/**
	 * Notify all inspector listeners of an actor's state change.
	 * @param state - The new state.
	 * @internal
	 */
	onStateChange = throttle((state: unknown) => {
		this.__broadcast(this.#createInfoMessage());
	}, 500);

	/**
	 *
	 * Notify all inspector listeners of an actor's connections change.
	 * @param connections - The new connections.
	 * @internal
	 */
	onConnectionsChange = throttle(
		(connections: Map<ConnectionId, Connection<AnyActor>>) => {
			this.__broadcast(this.#createInfoMessage());
		},
		500,
	);

	constructor(actor: AnyActor) {
		this.actor = actor;
	}

	/**
	 * Broadcast a message to all inspector connections.
	 * @internal
	 */
	__broadcast(msg: ToClient) {
		for (const conn of this.#connections.values()) {
			conn.send(msg);
		}
	}

	/**
	 * Process a message from a connection.
	 * @internal
	 */
	__processMessage(connection: InspectorConnection, message: ToServer) {
		if (message.type === "info") {
			return connection.send(this.#createInfoMessage());
		}
		if (message.type === "setState") {
			this.actor._state = message.state;
			return;
		}

		throw new errors.Unreachable(message);
	}

	/**
	 * Create an info message for the inspector.
	 */
	#createInfoMessage(): ToClient {
		return {
			type: "info",
			connections: Array.from(this.actor._connections).map(
				([id, connection]) => ({
					id,
					parameters: connection.parameters,
					state: {
						value: connection._stateEnabled ? connection.state : undefined,
						enabled: connection._stateEnabled,
					},
				}),
			),
			rpcs: this.actor._rpcs,
			state: {
				value: this.actor._stateEnabled ? this.actor._state : undefined,
				enabled: this.actor._stateEnabled,
			},
		};
	}

	/**
	 * Create a new connection to the inspector.
	 * Connection will be notified of all state changes.
	 * @internal
	 */
	__createConnection(ws: WSContext): InspectorConnection {
		const id = `${this.#conId++}`;
		const con = new InspectorConnection(id, ws);
		this.#connections.set(id, con);
		return con;
	}

	/**
	 * Remove a connection from the inspector.
	 * @internal
	 */
	__removeConnection(con: InspectorConnection): void {
		this.#connections.delete(con.id);
	}
}
