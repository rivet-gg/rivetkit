// import type { AnyWorkerInstance } from "@/worker/instance";
// import type { AnyConn, ConnId } from "@/worker/connection";
// import { throttle } from "@/worker/utils";
// import type { UpgradeWebSocket } from "hono/ws";
// import * as errors from "@/worker/errors";
// import {
// 	type ToClient,
// 	type ToServer,
// 	ToServerSchema,
// } from "@/inspector/protocol/worker/mod";
// import { logger } from "@/worker/log";
// import {
// 	createInspectorRoute,
// 	Inspector,
// 	type InspectorConnection,
// 	type InspectorConnHandler,
// } from "./common";
// import type { InspectorConfig } from "./config";
//
// export type WorkerInspectorConnHandler = InspectorConnHandler<ToServer>;
//
// /**
//  * Create a router for the worker inspector.
//  * @internal
//  */
// export function createWorkerInspectorRouter(
// 	upgradeWebSocket: UpgradeWebSocket | undefined,
// 	onConnect: WorkerInspectorConnHandler | undefined,
// 	config: InspectorConfig,
// ) {
// 	return createInspectorRoute<WorkerInspectorConnHandler>({
// 		upgradeWebSocket,
// 		onConnect,
// 		config,
// 		logger: logger(),
// 		serverMessageSchema: ToServerSchema,
// 	});
// }
//
// /**
//  * Represents a connection to a worker.
//  * @internal
//  */
// export type WorkerInspectorConnection = InspectorConnection<ToClient>;
//
// /**
//  * Provides a unified interface for inspecting worker external and internal state.
//  */
// export class WorkerInspector extends Inspector<ToClient, ToServer> {
// 	/**
// 	 * Inspected worker instance.
// 	 * @internal
// 	 */
// 	readonly worker: AnyWorkerInstance;
//
// 	/**
// 	 * Notify all inspector listeners of a worker's state change.
// 	 * @param state - The new state.
// 	 * @internal
// 	 */
// 	onStateChange = throttle((state: unknown) => {
// 		this.broadcast(this.#createInfoMessage());
// 	}, 500);
//
// 	/**
// 	 *
// 	 * Notify all inspector listeners of a worker's connections change.
// 	 * @param connections - The new connections.
// 	 * @internal
// 	 */
// 	onConnChange = throttle((connections: Map<ConnId, AnyConn>) => {
// 		this.broadcast(this.#createInfoMessage());
// 	}, 500);
//
// 	constructor(worker: AnyWorkerInstance) {
// 		super();
// 		this.worker = worker;
// 	}
//
// 	/**
// 	 * Process a message from a connection.
// 	 * @internal
// 	 */
// 	processMessage(connection: WorkerInspectorConnection, message: ToServer) {
// 		super.processMessage(connection, message);
// 		if (message.type === "info") {
// 			return connection.send(this.#createInfoMessage());
// 		}
// 		if (message.type === "setState") {
// 			this.worker.state = message.state;
// 			return;
// 		}
//
// 		throw new errors.Unreachable(message);
// 	}
//
// 	/**
// 	 * Create an info message for the inspector.
// 	 */
// 	#createInfoMessage(): ToClient {
// 		return {
// 			type: "info",
// 			connections: Array.from(this.worker.conns).map(([id, connection]) => ({
// 				id,
// 				parameters: connection.params,
// 				state: {
// 					value: connection._stateEnabled ? connection.state : undefined,
// 					enabled: connection._stateEnabled,
// 				},
// 			})),
// 			actions: this.worker.actions,
// 			state: {
// 				value: this.worker.stateEnabled ? this.worker.state : undefined,
// 				enabled: this.worker.stateEnabled,
// 			},
// 		};
// 	}
// }
