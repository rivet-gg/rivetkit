import type { AnyActorInstance } from "@/actor/instance";
import type { AnyConn, ConnId } from "@/actor/connection";
import { throttle } from "@/actor/utils";
import type { UpgradeWebSocket } from "hono/ws";
import * as errors from "@/actor/errors";
import {
	type ToClient,
	type ToServer,
	ToServerSchema,
} from "@/inspector/protocol/actor/mod";
import { logger } from "@/actor/log";
import {
	createInspectorRoute,
	Inspector,
	type InspectorConnection,
	type InspectorConnHandler,
} from "./common";
import type { InspectorConfig } from "./config";

export type ActorInspectorConnHandler = InspectorConnHandler<ToServer>;

/**
 * Create a router for the actor inspector.
 * @internal
 */
export function createActorInspectorRouter(
	upgradeWebSocket: UpgradeWebSocket | undefined,
	onConnect: ActorInspectorConnHandler | undefined,
	config: InspectorConfig,
) {
	return createInspectorRoute<ActorInspectorConnHandler>({
		upgradeWebSocket,
		onConnect,
		config,
		logger: logger(),
		serverMessageSchema: ToServerSchema,
	});
}

/**
 * Represents a connection to an actor.
 * @internal
 */
export type ActorInspectorConnection = InspectorConnection<ToClient>;

/**
 * Provides a unified interface for inspecting actor external and internal state.
 */
export class ActorInspector extends Inspector<ToClient, ToServer> {
	/**
	 * Inspected actor instance.
	 * @internal
	 */
	readonly actor: AnyActorInstance;

	/**
	 * Notify all inspector listeners of an actor's state change.
	 * @param state - The new state.
	 * @internal
	 */
	onStateChange = throttle((state: unknown) => {
		this.broadcast(this.#createInfoMessage());
	}, 500);

	/**
	 *
	 * Notify all inspector listeners of an actor's connections change.
	 * @param connections - The new connections.
	 * @internal
	 */
	onConnChange = throttle((connections: Map<ConnId, AnyConn>) => {
		this.broadcast(this.#createInfoMessage());
	}, 500);

	constructor(actor: AnyActorInstance) {
		super();
		this.actor = actor;
	}

	/**
	 * Process a message from a connection.
	 * @internal
	 */
	processMessage(connection: ActorInspectorConnection, message: ToServer) {
		super.processMessage(connection, message);
		if (message.type === "info") {
			return connection.send(this.#createInfoMessage());
		}
		if (message.type === "setState") {
			this.actor.state = message.state;
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
			connections: Array.from(this.actor.conns).map(([id, connection]) => ({
				id,
				parameters: connection.params,
				state: {
					value: connection._stateEnabled ? connection.state : undefined,
					enabled: connection._stateEnabled,
				},
			})),
			actions: this.actor.actions,
			state: {
				value: this.actor.stateEnabled ? this.actor.state : undefined,
				enabled: this.actor.stateEnabled,
			},
		};
	}
}
