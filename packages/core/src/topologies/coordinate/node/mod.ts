import type { GlobalState } from "../topology";
import { logger } from "../log";
import {
	type NodeMessage,
	NodeMessageSchema,
	type ToFollowerConnectionClose,
	type ToFollowerMessage,
	type Ack,
	type ToLeaderConnectionClose,
	type ToLeaderConnectionOpen,
	type ToLeaderMessage,
} from "./protocol";
import { WorkerPeer } from "../worker-peer";
import type { CoordinateDriver } from "../driver";
import { CONN_DRIVER_COORDINATE_RELAY, type CoordinateRelayState } from "../conn/driver";
import { assertUnreachable } from "@/common/utils";

export class Node {
	#CoordinateDriver: CoordinateDriver;
	#globalState: GlobalState;

	constructor(CoordinateDriver: CoordinateDriver, globalState: GlobalState) {
		this.#CoordinateDriver = CoordinateDriver;
		this.#globalState = globalState;
	}

	async start() {
		logger().debug("starting", { nodeId: this.#globalState.nodeId });

		// Subscribe to events
		//
		// We intentionally design this so there's only one topic for the subscriber to listen on in order to reduce chattiness to the pubsub server.
		//
		// If we had a dedicated topic for each worker, we'd have to create a SUB for each leader & follower for each worker which is much more expensive than one for each node.
		//
		// Additionally, in most serverless environments, 1 node usually owns 1 worker, so this would double the RTT to create the required subscribers.
		await this.#CoordinateDriver.createNodeSubscriber(
			this.#globalState.nodeId,
			this.#onMessage.bind(this),
		);

		logger().debug("node started", { nodeId: this.#globalState.nodeId });
	}

	async #onMessage(message: string) {
		// TODO: try catch this
		// TODO: Support multiple protocols for the worker

		// Parse message
		const { data, success, error } = NodeMessageSchema.safeParse(
			JSON.parse(message),
		);
		if (!success) {
			throw new Error(`Invalid NodeMessage message: ${error}`);
		}

		// Ack message
		if (data.n && data.m) {
			if ("a" in data.b) {
				throw new Error("Ack messages cannot request ack in response");
			}

			const messageRaw: NodeMessage = {
				b: {
					a: {
						m: data.m,
					},
				},
			};
			this.#CoordinateDriver.publishToNode(data.n, JSON.stringify(messageRaw));
		}

		// Handle message
		if ("a" in data.b) {
			await this.#onAck(data.b.a);
		} else if ("lco" in data.b) {
			await this.#onLeaderConnectionOpen(data.n, data.b.lco);
		} else if ("lcc" in data.b) {
			await this.#onLeaderConnectionClose(data.b.lcc);
		} else if ("lm" in data.b) {
			await this.#onLeaderMessage(data.b.lm);
		} else if ("fcc" in data.b) {
			await this.#onFollowerConnectionClose(data.b.fcc);
		} else if ("fm" in data.b) {
			await this.#onFollowerMessage(data.b.fm);
		} else {
			assertUnreachable(data.b);
		}
	}

	async #onAck({ m: messageId }: Ack) {
		const resolveAck = this.#globalState.messageAckResolvers.get(messageId);
		if (resolveAck) {
			resolveAck();
			this.#globalState.messageAckResolvers.delete(messageId);
		} else {
			logger().warn("missing ack resolver", { messageId });
		}
	}

	async #onLeaderConnectionOpen(
		nodeId: string | undefined,
		{
			ai: workerId,
			ci: connId,
			ct: connToken,
			p: connParams,
			ad: authData,
		}: ToLeaderConnectionOpen,
	) {
		if (!nodeId) {
			logger().error("node id not provided for leader connection open event");
			return;
		}

		logger().debug("received connection open", { workerId, connId });

		// Connection open

		try {
			const worker = WorkerPeer.getLeaderWorker(this.#globalState, workerId);
			if (!worker) {
				logger().warn("received message for nonexistent worker leader", {
					workerId,
				});
				return;
			}

			const connState = await worker.prepareConn(connParams);
			await worker.createConn(
				connId,
				connToken,
				connParams,
				connState,
				CONN_DRIVER_COORDINATE_RELAY,
				{ nodeId } satisfies CoordinateRelayState,
				authData,
			);

			// Connection init will be sent by `Worker`
		} catch (error) {
			logger().warn("failed to open connection", { error: `${error}` });

			// TODO: We don't have the connection ID
			// Forward close message
			//const message: ToFollower = {
			//	b: {
			//		cc: {
			//			ci: `${conn.id}`,
			//			r: `Error: ${error}`,
			//		},
			//	},
			//};
			//redis.publish(
			//	PUBSUB.WORKER.follower(workerId, followerId),
			//	JSON.stringify(message),
			//);
		}
	}

	async #onLeaderConnectionClose({
		ai: workerId,
		ci: connId,
	}: ToLeaderConnectionClose) {
		logger().debug("received connection close", { workerId });

		const worker = WorkerPeer.getLeaderWorker(this.#globalState, workerId);
		if (!worker) {
			logger().warn("received message for nonexistent worker leader", {
				workerId,
			});
			return;
		}

		const conn = worker.__getConnForId(connId);
		if (conn) {
			worker.__removeConn(conn);
		} else {
			logger().warn("received connection close for nonexisting connection", {
				connId,
			});
		}
	}

	async #onLeaderMessage({
		ai: workerId,
		ci: connId,
		ct: connToken,
		m: message,
	}: ToLeaderMessage) {
		logger().debug("received connection message", { workerId, connId });

		// Get leader
		const worker = WorkerPeer.getLeaderWorker(this.#globalState, workerId);
		if (!worker) {
			logger().warn("received message for nonexistent worker leader", {
				workerId,
			});
			return;
		}

		// Get connection
		const conn = worker.__getConnForId(connId);
		if (conn) {
			// Validate token
			if (conn._token !== connToken) {
				throw new Error("connection token does not match");
			}

			// Process message
			await worker.processMessage(message, conn);
		} else {
			logger().warn("received message for nonexisting connection", {
				connId,
			});
		}
	}

	async #onFollowerConnectionClose({
		ci: connId,
		r: reason,
	}: ToFollowerConnectionClose) {
		const conn = this.#globalState.relayConns.get(connId);
		if (!conn) {
			logger().warn("missing connection", { connId });
			return;
		}

		conn.disconnect(true, reason);
	}

	async #onFollowerMessage({ ci: connId, m: message }: ToFollowerMessage) {
		const conn = this.#globalState.relayConns.get(connId);
		if (!conn) {
			logger().warn("missing connection", { connId });
			return;
		}

		conn.onMessage(message);
	}
}
