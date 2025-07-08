import type { ConnId } from "@/actor/connection";
import { deconstructError, noopNext, safeStringify } from "@/common/utils";
import type { HonoRequest, Handler } from "hono";
import type { WSContext, WSEvents } from "hono/ws";
import type { InspectorConfig } from "./config";
import type { Logger } from "@/common/log";
import * as errors from "@/actor/errors";
import type { ZodSchema } from "zod";
import type { ManagerDriver } from "@/manager/driver";
import type { ManagerInspectorConnection } from "./manager";
import type { UpgradeWebSocket } from "@/utils";
import invariant from "invariant";

interface ConnectInspectorOpts {
	req: HonoRequest;
}

export interface ConnectInspectorOutput<MsgSchema> {
	onOpen: (ws: WSContext) => Promise<void>;
	onMessage: (message: MsgSchema) => Promise<void>;
	onClose: () => Promise<void>;
}

export type InspectorConnHandler<MsgSchema> = (
	opts: ConnectInspectorOpts,
) => Promise<ConnectInspectorOutput<MsgSchema>>;

/**
 * Represents a connection to a actor.
 * @internal
 */
export class InspectorConnection<MsgSchema> {
	constructor(
		public readonly id: string,
		private readonly ws: WSContext,
	) {}

	send(message: MsgSchema) {
		try {
			const serialized = safeStringify(message, 128 * 1024 * 1024);
			return this.ws.send(serialized);
		} catch {
			return this.ws.send(
				JSON.stringify({
					type: "error",
					message: "Failed to serialize message due to size constraints.",
				}),
			);
		}
	}
}

/**
 * Provides a unified interface for inspecting actor and managers.
 */
export class Inspector<ToClientSchema, ToServerSchema> {
	/**
	 * Map of all connections to the inspector.
	 * @internal
	 */
	readonly #connections = new Map<
		ConnId,
		InspectorConnection<ToClientSchema>
	>();

	/**
	 * Connection counter.
	 */
	#conId = 0;

	/**
	 * Broadcast a message to all inspector connections.
	 * @internal
	 */
	broadcast(msg: ToClientSchema) {
		for (const conn of this.#connections.values()) {
			conn.send(msg);
		}
	}

	/**
	 * Process a message from a connection.
	 * @internal
	 */
	processMessage(
		connection: InspectorConnection<ToClientSchema>,
		message: ToServerSchema,
	) {}

	/**
	 * Create a new connection to the inspector.
	 * Connection will be notified of all state changes.
	 * @internal
	 */
	createConnection(ws: WSContext): InspectorConnection<ToClientSchema> {
		const id = `${this.#conId++}`;
		const con = new InspectorConnection<ToClientSchema>(id, ws);
		this.#connections.set(id, con);
		return con;
	}

	/**
	 * Remove a connection from the inspector.
	 * @internal
	 */
	removeConnection(con: InspectorConnection<ToClientSchema>): void {
		this.#connections.delete(con.id);
	}
}

export interface InspectorRouteOpts<Schema = unknown> {
	upgradeWebSocket: UpgradeWebSocket | undefined;
	config: InspectorConfig;
	logger: Logger;
	driver: ManagerDriver;
	serverMessageSchema: ZodSchema<Schema>;
}

export function handleInspectorRoute({
	upgradeWebSocket,
	config,
	logger,
	driver,
	serverMessageSchema,
}: InspectorRouteOpts): Handler {
	return (c) => {
		const inspector = driver.inspector;
		invariant(inspector, "inspector not supported on this platform");
		invariant(upgradeWebSocket, "websockets not supported on this platform");

		return upgradeWebSocket(async (c) => {
			let conn: ManagerInspectorConnection | undefined;
			return {
				onOpen: async (_, ws) => {
					try {
						conn = inspector.createConnection(ws);
					} catch (error) {
						const { code } = deconstructError(error, logger, {
							wsEvent: "open",
						});
						ws.close(1011, code);
					}
				},
				onClose: async (_, ws) => {
					try {
						if (conn) {
							inspector.removeConnection(conn);
						}
					} catch (error) {
						const { code } = deconstructError(error, logger, {
							wsEvent: "close",
						});
						ws.close(1011, code);
					}
				},
				onMessage: async (event, ws) => {
					try {
						if (!conn) {
							logger.warn("`conn` does not exist");
							return;
						}

						const { success, data, error } = serverMessageSchema.safeParse(
							JSON.parse(event.data.valueOf() as string),
						);
						if (!success) throw new errors.MalformedMessage(error);

						await inspector.processMessage(conn, data);
					} catch (error) {
						const { code } = deconstructError(error, logger, {
							wsEvent: "message",
						});
						ws.close(1011, code);
					}
				},
			} satisfies WSEvents;
		})(c, noopNext());
	};
}
