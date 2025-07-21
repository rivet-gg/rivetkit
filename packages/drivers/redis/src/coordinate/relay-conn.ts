import {
	generateConnId,
	generateConnToken,
	type Registry,
	type RegistryConfig,
	type RunConfig,
} from "@rivetkit/core";
import type { Client } from "@rivetkit/core/client";
import type { ActorDriver } from "@rivetkit/core/driver-helpers";
import * as errors from "@rivetkit/core/errors";
import { ActorPeer } from "./actor-peer";
import type { CoordinateDriverConfig } from "./config";
import type { CoordinateDriver } from "./driver";
import { logger } from "./log";
import {
	publishMessageToLeader,
	publishMessageToLeaderNoRetry,
} from "./node/message";
import type { NodeMessage } from "./node/protocol";
import type { GlobalState } from "./types";

export interface RelayConnDriver {
	/** Called on disconnect (regardless of source). */
	disconnect(reason?: string): Promise<void>;
}

/**
 * This is different than `Connection`. `Connection` represents the data of the connection state on the actor itself, `RelayConnection` supports managing a connection for a actor running on another machine over pubsub.
 */
export class RelayConn {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#driverConfig: CoordinateDriverConfig;
	#coordinateDriver: CoordinateDriver;
	#actorDriver: ActorDriver;
	#inlineClient: Client<Registry<any>>;
	#globalState: GlobalState;
	#driver: RelayConnDriver;
	#actorId: string;

	#actorPeer?: ActorPeer;

	#connId?: string;
	#connToken?: string;

	#disposed = false;

	#abortController = new AbortController();

	public get actorId(): string {
		return this.#actorId;
	}

	public get connId(): string {
		if (!this.#connId) throw new errors.InternalError("Missing connId");
		return this.#connId;
	}

	public get connToken(): string {
		if (!this.#connToken) throw new errors.InternalError("Missing connToken");
		return this.#connToken;
	}

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		driverConfig: CoordinateDriverConfig,
		actorDriver: ActorDriver,
		inlineClient: Client<Registry<any>>,
		coordinateDriver: CoordinateDriver,
		globalState: GlobalState,
		driver: RelayConnDriver,
		actorId: string,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#driverConfig = driverConfig;
		this.#coordinateDriver = coordinateDriver;
		this.#actorDriver = actorDriver;
		this.#inlineClient = inlineClient;
		this.#driver = driver;
		this.#globalState = globalState;
		this.#actorId = actorId;
	}

	async start() {
		// TODO: Handle errors gracefully

		// Add connection
		const connId = generateConnId();
		const connToken = generateConnToken();
		this.#connId = connId;
		this.#connToken = connToken;

		logger().debug("starting relay connection", {
			actorId: this.#actorId,
			connId: this.#connId,
		});

		// Create actor peer
		this.#actorPeer = await ActorPeer.acquire(
			this.#registryConfig,
			this.#runConfig,
			this.#driverConfig,
			this.#actorDriver,
			this.#inlineClient,
			this.#coordinateDriver,
			this.#globalState,
			this.#actorId,
			connId,
		);

		this.#globalState.relayConns.set(connId, this);
	}

	async publishMessageToleader(message: NodeMessage, retry: boolean) {
		if (this.#disposed) {
			logger().warn(
				"attempted to call sendMessageToLeader on disposed RelayConn",
			);
			return;
		}

		if (retry) {
			await publishMessageToLeader(
				this.#registryConfig,
				this.#driverConfig,
				this.#coordinateDriver,
				this.#globalState,
				this.#actorId,
				message,
				this.#abortController.signal,
			);
		} else {
			await publishMessageToLeaderNoRetry(
				this.#registryConfig,
				this.#driverConfig,
				this.#coordinateDriver,
				this.#globalState,
				this.#actorId,
				message,
				this.#abortController.signal,
			);
		}
	}

	/**
	 * Closes the connection and cleans it up.
	 *
	 * @param fromLeader - If this message is coming from the leader. This will prevent sending a close message back to the leader.
	 */
	async disconnect(
		fromLeader: boolean,
		reason: string | undefined,
		disconnectMessageToleader: NodeMessage | undefined,
	) {
		if (this.#disposed) {
			logger().warn("attempted to call disconnect on disposed RelayConn");
			return;
		}

		this.#disposed = true;

		this.#abortController.abort();

		// Disconnect driver
		await this.#driver.disconnect(reason);

		// Clean up state
		if (this.#connId) {
			// Remove connection
			this.#globalState.relayConns.delete(this.#connId);

			// Publish connection close
			if (!fromLeader && this.#actorPeer?.leaderNodeId) {
				if (disconnectMessageToleader) {
					await publishMessageToLeader(
						this.#registryConfig,
						this.#driverConfig,
						this.#coordinateDriver,
						this.#globalState,
						this.#actorId,
						disconnectMessageToleader,
						undefined,
					);
				}
			}

			// Remove reference to actor (will shut down if no more references)
			//
			// IMPORTANT: Do this last since we need to send the connection close event
			await this.#actorPeer?.removeConnectionReference(this.#connId);
		} else {
			logger().warn("disposing connection without connection id");
		}
	}
}
