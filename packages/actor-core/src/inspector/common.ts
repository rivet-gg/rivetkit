import type { ConnId } from "@/actor/connection";
import { deconstructError, safeStringify } from "@/common/utils";
import { Hono, type HonoRequest } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { InspectorConfig } from "./config";
import type { Logger } from "@/common/log";
import * as errors from "@/actor/errors";
import type { ZodSchema } from "zod";

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
 * Represents a connection to an actor.
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

export function createInspectorRoute<
	ConnectionHandler extends
		InspectorConnHandler<// biome-ignore lint/suspicious/noExplicitAny: allow any subtype here
		any>,
>({
	upgradeWebSocket,
	onConnect,
	config,
	logger,
	serverMessageSchema,
}: {
	upgradeWebSocket: UpgradeWebSocket | undefined;
	onConnect: ConnectionHandler | undefined;
	config: InspectorConfig;
	logger: Logger;
	serverMessageSchema: ZodSchema<unknown>;
}) {
	const app = new Hono();

	if (!upgradeWebSocket || !onConnect || !config.enabled) {
		return app.get("/", async (c) => {
			return c.json({
				error: "Inspector disabled. Only available on WebSocket connections.",
			});
		});
	}

	return app.get(
		"/",
		async (c, next) => {
			const result =
				(await config.onRequest?.({ req: c.req })) ?? config.enabled;
			if (!result) return c.json({ error: "Inspector disabled." }, 403);
			return next();
		},
		upgradeWebSocket(async (c) => {
			try {
				const handler = await onConnect({ req: c.req });
				return {
					onOpen: async (_, ws) => {
						try {
							await handler.onOpen(ws);
						} catch (error) {
							const { code } = deconstructError(error, logger, {
								wsEvent: "open",
							});
							ws.close(1011, code);
						}
					},
					onClose: async () => {
						try {
							await handler.onClose();
						} catch (error) {
							deconstructError(error, logger, {
								wsEvent: "close",
							});
						}
					},
					onMessage: async (event, ws) => {
						try {
							const { success, data, error } = serverMessageSchema.safeParse(
								JSON.parse(event.data.valueOf() as string),
							);
							if (!success) throw new errors.MalformedMessage(error);

							await handler.onMessage(data);
						} catch (error) {
							const { code } = deconstructError(error, logger, {
								wsEvent: "message",
							});
							ws.close(1011, code);
						}
					},
				};
			} catch (error) {
				deconstructError(error, logger, {});
				return {};
			}
		}),
	);
}
