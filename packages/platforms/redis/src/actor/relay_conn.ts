import { RedisConfig } from "@/config";
import { GlobalState } from "@/router/mod";
import { logger } from "@/log";
import type { Context as HonoContext } from "hono";
import Redis from "ioredis";
import { streamSSE } from "hono/streaming";
import { Actor, ActorTags } from "actor-core";
import {
	generateConnectionId,
	generateConnectionToken,
} from "actor-core/platform";
import { encodeDataToString, serialize } from "actor-core/actor/protocol/serde";
import { NodeMessage } from "@/node/protocol";
import type * as messageToClient from "actor-core/actor/protocol/message/to_client";
import { ActorPeer } from "./peer";
import { KEYS, PUBSUB } from "@/redis";
import * as errors from "actor-core/actor/errors";
import { publishMessageToLeader } from "@/node/message";

export interface RelayConnectionDriver {
	sendMessage(message: messageToClient.ToClient): void;
	disconnect(reason?: string): Promise<void>;
}

/**
 * This is different than `Connection`. `Connection` represents the data of the connection state on the actor itself, `RelayConnection` supports managing a connection for an actor running on another machine over pubsub.
 */
export class RelayConnection {
	#redis: Redis;
	#config: RedisConfig;
	#globalState: GlobalState;
	#driver: RelayConnectionDriver;
	#actorId: string;
	#parameters: unknown;

	#actorPeer?: ActorPeer;

	#connId?: string;
	#connToken?: string;

	#disposed = false;

	#abortController = new AbortController();

	public get connId(): string {
		if (!this.#connId) throw new errors.InternalError("Missing connId");
		return this.#connId;
	}

	public get connToken(): string {
		if (!this.#connToken) throw new errors.InternalError("Missing connToken");
		return this.#connToken;
	}

	constructor(
		redis: Redis,
		config: RedisConfig,
		globalState: GlobalState,
		driver: RelayConnectionDriver,
		actorId: string,
		parameters: unknown,
	) {
		this.#redis = redis;
		this.#config = config;
		this.#driver = driver;
		this.#globalState = globalState;
		this.#actorId = actorId;
		this.#parameters = parameters;
	}

	async start() {
		// TODO: Handle errors graecfully

		// Add connection
		const connId = generateConnectionId();
		const connToken = generateConnectionToken();
		this.#connId = connId;
		this.#connToken = connToken;

		logger().info("starting relay connection", {
			actorId: this.#actorId,
			connId: this.#connId,
		});

		// Create actor peer
		this.#actorPeer = await ActorPeer.acquire(
			this.#redis,
			this.#config,
			this.#globalState,
			this.#actorId,
			connId,
		);

		this.#globalState.relayConnections.set(connId, this);

		// Publish connection open
		await publishMessageToLeader(
			this.#redis,
			this.#config,
			this.#globalState,
			this.#actorId,
			{
				b: {
					lco: {
						ai: this.#actorId,
						ci: connId,
						ct: connToken,
						p: this.#parameters,
					},
				},
			},
			this.#abortController.signal,
		);

		// The leader will send the connection init to the client or close if invalid
	}

	onMessage(message: messageToClient.ToClient) {
		this.#driver.sendMessage(message);
	}

	/**
	 * Closes the connection and cleans it up.
	 *
	 * @param fromLeader - If this message is coming from the leader. This will prevent sending a close message back to the leader.
	 */
	async disconnect(fromLeader: boolean, reason?: string) {
		if (this.#disposed) return;

		this.#disposed = true;

		this.#abortController.abort();

		// Disconnect driver
		await this.#driver.disconnect(reason);

		// Clean up state
		if (this.#connId) {
			// Remove connection
			this.#globalState.relayConnections.delete(this.#connId);

			// Publish connection close
			if (!fromLeader && this.#actorPeer?.leaderNodeId) {
				// Publish connection close
				await publishMessageToLeader(
					this.#redis,
					this.#config,
					this.#globalState,
					this.#actorId,
					{
						b: {
							lcc: {
								ai: this.#actorId,
								ci: this.#connId,
							},
						},
					},
					undefined
				);
			}

			// Remove reference ot actor (will shut down if no more references)
			//
			// IMPORTANT: Do this last since we need to send the connection close event
			await this.#actorPeer?.removeConnectionReference(this.#connId);
		} else {
			logger().warn("disposing connection without connection id");
		}
	}
}
