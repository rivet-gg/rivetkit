import type { GlobalState } from "@/topologies/coordinate/topology";
import type * as messageToClient from "@/worker/protocol/message/to-client";
import * as errors from "@/worker/errors";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";
import { WorkerPeer } from "../worker-peer";
import { publishMessageToLeader } from "../node/message";
import { generateConnId, generateConnToken } from "@/worker/connection";
import type { WorkerDriver } from "@/worker/driver";
import { DriverConfig } from "@/driver-helpers/config";
import { RegistryConfig } from "@/registry/config";
import { unknown } from "zod";

export interface RelayConnDriver {
	sendMessage(message: messageToClient.ToClient): void;
	disconnect(reason?: string): Promise<void>;
}

/**
 * This is different than `Connection`. `Connection` represents the data of the connection state on the worker itself, `RelayConnection` supports managing a connection for a worker running on another machine over pubsub.
 */
export class RelayConn {
	#registryConfig: RegistryConfig;
	#driverConfig: DriverConfig;
	#coordinateDriver: CoordinateDriver;
	#workerDriver: WorkerDriver;
	#globalState: GlobalState;
	#driver: RelayConnDriver;
	#workerId: string;
	#parameters: unknown;
	#authData: unknown;

	#workerPeer?: WorkerPeer;

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
		registryConfig: RegistryConfig,
		driverConfig: DriverConfig,
		workerDriver: WorkerDriver,
		CoordinateDriver: CoordinateDriver,
		globalState: GlobalState,
		driver: RelayConnDriver,
		workerId: string,
		parameters: unknown,
		authData: unknown,
	) {
		this.#registryConfig = registryConfig;
		this.#driverConfig = driverConfig;
		this.#coordinateDriver = CoordinateDriver;
		this.#workerDriver = workerDriver;
		this.#driver = driver;
		this.#globalState = globalState;
		this.#workerId = workerId;
		this.#parameters = parameters;
		this.#authData = authData;
	}

	async start() {
		// TODO: Handle errors graecfully

		// Add connection
		const connId = generateConnId();
		const connToken = generateConnToken();
		this.#connId = connId;
		this.#connToken = connToken;

		logger().info("starting relay connection", {
			workerId: this.#workerId,
			connId: this.#connId,
		});

		// Create worker peer
		this.#workerPeer = await WorkerPeer.acquire(
			this.#registryConfig,
			this.#driverConfig,
			this.#workerDriver,
			this.#coordinateDriver,
			this.#globalState,
			this.#workerId,
			connId,
		);

		this.#globalState.relayConns.set(connId, this);

		// Publish connection open
		await publishMessageToLeader(
			this.#registryConfig,
			this.#driverConfig,
			this.#coordinateDriver,
			this.#globalState,
			this.#workerId,
			{
				b: {
					lco: {
						ai: this.#workerId,
						ci: connId,
						ct: connToken,
						p: this.#parameters,
						ad: this.#authData,
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
			this.#globalState.relayConns.delete(this.#connId);

			// Publish connection close
			if (!fromLeader && this.#workerPeer?.leaderNodeId) {
				// Publish connection close
				await publishMessageToLeader(
					this.#registryConfig,
					this.#driverConfig,
					this.#coordinateDriver,
					this.#globalState,
					this.#workerId,
					{
						b: {
							lcc: {
								ai: this.#workerId,
								ci: this.#connId,
							},
						},
					},
					undefined
				);
			}

			// Remove reference to worker (will shut down if no more references)
			//
			// IMPORTANT: Do this last since we need to send the connection close event
			await this.#workerPeer?.removeConnectionReference(this.#connId);
		} else {
			logger().warn("disposing connection without connection id");
		}
	}
}
