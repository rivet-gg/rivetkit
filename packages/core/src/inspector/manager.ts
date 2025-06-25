// import type { UpgradeWebSocket } from "hono/ws";
// import {
// 	type ToClient,
// 	type ToServer,
// 	ToServerSchema,
// } from "@/inspector/protocol/manager/mod";
// import { logger } from "@/manager/log";
// import * as errors from  "@/actor/errors";
// import {
// 	createInspectorRoute,
// 	Inspector,
// 	type InspectorConnection,
// 	type InspectorConnHandler,
// } from "./common";
// import type { InspectorConfig } from "./config";
// import type { ManagerDriver } from "@/manager/driver";
// import { throttle } from  "@/actor/utils";
//
// export type ManagerInspectorConnHandler = InspectorConnHandler<ToServer>;
//
// interface Actor {
// 	id: string;
// 	name: string;
// 	key: string[];
// 	region?: string;
// 	createdAt?: string;
// 	destroyedAt?: string;
// }
//
// /**
//  * Create a router for the Manager Inspector.
//  * @internal
//  */
// export function createManagerInspectorRouter(
// 	upgradeWebSocket: UpgradeWebSocket | undefined,
// 	onConnect: ManagerInspectorConnHandler | undefined,
// 	config: InspectorConfig,
// ) {
// 	return createInspectorRoute<ManagerInspectorConnHandler>({
// 		upgradeWebSocket,
// 		onConnect,
// 		config,
// 		logger: logger(),
// 		serverMessageSchema: ToServerSchema,
// 	});
// }
//
// /**
//  * Represents a connection to a actor.
//  * @internal
//  */
// export type ManagerInspectorConnection = InspectorConnection<ToClient>;
//
// /**
//  * Provides a unified interface for inspecting actor external and internal state.
//  */
// export class ManagerInspector extends Inspector<ToClient, ToServer> {
// 	/**
// 	 * Inspected actor instance.
// 	 * @internal
// 	 */
// 	readonly driver: ManagerDriver;
//
// 	/**
// 	 * Notify all inspector listeners of a actor's state change.
// 	 * @param state - The new state.
// 	 */
// 	public onActorsChange = throttle((actors: Actor[]) => {
// 		this.broadcast({ type: "actors", actors });
// 	}, 500);
//
// 	constructor(
// 		driver: ManagerDriver,
// 		private readonly hooks: {
// 			getAllActors: () => Actor[];
// 			getAllTypesOfActors: () => string[];
// 		},
// 	) {
// 		super();
// 		this.driver = driver;
// 	}
//
// 	/**
// 	 * Process a message from a connection.
// 	 * @internal
// 	 */
// 	processMessage(connection: ManagerInspectorConnection, incoming: unknown) {
// 		const result = ToServerSchema.safeParse(incoming);
//
// 		if (!result.success) {
// 			logger().warn("Invalid message", result.error);
// 			return connection.send({
// 				type: "error",
// 				message: "Invalid message",
// 			});
// 		}
// 		const message = result.data;
//
// 		if (message.type === "info") {
// 			return connection.send({
// 				type: "info",
// 				actors: this.hooks.getAllActors(),
// 				types: this.hooks.getAllTypesOfActors(),
// 			});
// 		}
//
// 		if (message.type === "destroy") {
// 			// TODO
// 			return;
// 		}
//
// 		throw new errors.Unreachable(message);
// 	}
// }
