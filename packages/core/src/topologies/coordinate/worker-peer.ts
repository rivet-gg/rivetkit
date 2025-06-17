import type { GlobalState } from "@/topologies/coordinate/topology";
import { logger } from "./log";
import type { CoordinateDriver } from "./driver";
import type { WorkerInstance, AnyWorkerInstance } from "@/worker/instance";
import type { WorkerKey } from "@/common/utils";
import { WorkerDriver } from "@/worker/driver";
import {
	CONN_DRIVER_COORDINATE_RELAY,
	createCoordinateRelayDriver,
} from "./conn/driver";
import { DriverConfig } from "@/driver-helpers/config";
import { RegistryConfig, RegistryConfigSchema } from "@/registry/config";

export class WorkerPeer {
	#registryConfig: RegistryConfig;
	#driverConfig: DriverConfig;
	#coordinateDriver: CoordinateDriver;
	#workerDriver: WorkerDriver;
	#globalState: GlobalState;
	#workerId: string;
	#workerName?: string;
	#workerKey?: WorkerKey;
	#isDisposed = false;

	/** Connections that hold a reference to this worker. If this set is empty, the worker should be shut down. */
	#referenceConnections = new Set<string>();

	/** Node ID that's the leader for this worker. */
	#leaderNodeId?: string;

	/** Holds the insantiated worker class if is leader. */
	#loadedWorker?: AnyWorkerInstance;

	#heartbeatTimeout?: NodeJS.Timeout;

	get #isLeader() {
		return this.#leaderNodeId === this.#globalState.nodeId;
	}

	get leaderNodeId() {
		if (!this.#leaderNodeId) throw new Error("Not found leader node ID yet");
		return this.#leaderNodeId;
	}

	constructor(
		registryConfig: RegistryConfig,
		driverConfig: DriverConfig,
		CoordinateDriver: CoordinateDriver,
		workerDriver: WorkerDriver,
		globalState: GlobalState,
		workerId: string,
	) {
		this.#registryConfig = registryConfig;
		this.#driverConfig = driverConfig;
		this.#coordinateDriver = CoordinateDriver;
		this.#workerDriver = workerDriver;
		this.#globalState = globalState;
		this.#workerId = workerId;
	}

	/** Acquires a `WorkerPeer` for a connection and includes the connection ID in the references. */
	static async acquire(
		registryConfig: RegistryConfig,
		driverConfig: DriverConfig,
		workerDriver: WorkerDriver,
		CoordinateDriver: CoordinateDriver,
		globalState: GlobalState,
		workerId: string,
		connId: string,
	): Promise<WorkerPeer> {
		let peer = globalState.workerPeers.get(workerId);

		// Create peer if needed
		if (!peer) {
			peer = new WorkerPeer(
				registryConfig,
				driverConfig,
				CoordinateDriver,
				workerDriver,
				globalState,
				workerId,
			);
			globalState.workerPeers.set(workerId, peer);
			await peer.#start();
		}

		peer.#referenceConnections.add(connId);

		logger().debug("added worker reference", {
			workerId,
			connId,
			newReferenceCount: peer.#referenceConnections.size,
		});

		return peer;
	}

	static getLeaderWorker(
		globalState: GlobalState,
		workerId: string,
	): AnyWorkerInstance | undefined {
		const peer = globalState.workerPeers.get(workerId);
		if (!peer) return undefined;
		if (peer.#isLeader) {
			const worker = peer.#loadedWorker;
			if (!worker)
				throw new Error("Worker is leader, but loadedWorker is undefined");
			return worker;
		} else {
			return undefined;
		}
	}

	async #start() {
		// TODO: Handle errors graecfully
		// TODO: See redlock

		// TODO: renew lease
		// TODO: receive messages for new connections
		// TODO: listen for health check on connections
		// TODO: Close sub on connection close
		// TODO: Use a global Redis connection
		// TODO: Add TTL to connections
		// TODO: Maybe use queue for leader instead of pubsub so the P2P is durable
		// TODO: Remove worker from globalState

		// TODO: Add back NX
		// Acquire lease

		// TODO: Do this in 1 round trip with a Lua script

		// Acquire initial information
		const { worker } = await this.#coordinateDriver.startWorkerAndAcquireLease(
			this.#workerId,
			this.#globalState.nodeId,
			this.#registryConfig.workerPeer.leaseDuration,
		);
		// Log
		logger().debug("starting worker peer", {
			worker,
		});

		// Validate worker exists
		if (!worker) {
			throw new Error("Worker does not exist");
		}

		// Parse tags
		this.#workerName = worker.name;
		this.#workerKey = worker.key;

		// Handle leadership
		this.#leaderNodeId = worker.leaderNodeId;
		if (worker.leaderNodeId === this.#globalState.nodeId) {
			logger().debug("worker peer is leader", {
				workerId: this.#workerId,
				leaderNodeId: worker.leaderNodeId,
			});

			await this.#convertToLeader();
		} else {
			logger().debug("worker peer is follower", {
				workerId: this.#workerId,
				leaderNodeId: worker.leaderNodeId,
			});

			this.#leaderNodeId = worker.leaderNodeId;
		}

		// Schedule first heartbeat
		this.#scheduleHeartbeat();
	}

	async #heartbeat() {
		if (this.#isDisposed) return;

		// Execute heartbeat
		if (this.#isLeader) {
			await this.#extendLease();
		} else {
			await this.#attemptAcquireLease();
		}

		this.#scheduleHeartbeat();
	}

	#scheduleHeartbeat() {
		// Schedule next heartbeat (leadership status may have changed)
		let hbTimeout: number;
		if (this.#isLeader) {
			hbTimeout =
				this.#registryConfig.workerPeer.leaseDuration -
				this.#registryConfig.workerPeer.renewLeaseGrace;
		} else {
			// TODO: Add jitter
			hbTimeout =
				this.#registryConfig.workerPeer.checkLeaseInterval +
				Math.random() * this.#registryConfig.workerPeer.checkLeaseJitter;
		}
		if (hbTimeout < 0)
			throw new Error("Worker peer heartbeat timeout is negative, check config");
		this.#heartbeatTimeout = setTimeout(this.#heartbeat.bind(this), hbTimeout);
	}

	async #convertToLeader() {
		if (!this.#workerName || !this.#workerKey) throw new Error("missing name or key");

		logger().debug("peer acquired leadership", { workerId: this.#workerId });

		// Build worker
		const workerName = this.#workerName;
		const definition = this.#registryConfig.workers[workerName];
		if (!definition) throw new Error(`no worker definition for name ${definition}`);

		// Create leader worker
		const worker = definition.instantiate();
		this.#loadedWorker = worker;

		await worker.start(
			{
				[CONN_DRIVER_COORDINATE_RELAY]: createCoordinateRelayDriver(
					this.#globalState,
					this.#coordinateDriver,
				),
			},
			this.#workerDriver,
			this.#workerId,
			this.#workerName,
			this.#workerKey,
			"unknown",
		);
	}

	/**
	 * Extends the lease if the current leader. Called on an interval for leaders leader.
	 *
	 * If the lease has expired for any reason (e.g. connection latency or database purged), this will automatically shut down the worker.
	 */
	async #extendLease() {
		const { leaseValid } = await this.#coordinateDriver.extendLease(
			this.#workerId,
			this.#globalState.nodeId,
			this.#registryConfig.workerPeer.leaseDuration,
		);
		if (leaseValid) {
			logger().debug("lease is valid", { workerId: this.#workerId });
		} else {
			logger().debug("lease is invalid", { workerId: this.#workerId });

			// Shut down. SInce the lease is already lost, no need to clear it.
			await this.#dispose(false);
		}
	}

	/**
	 * Attempts to acquire a lease (aka checks if the leader's lease has expired). Called on an interval for followers.
	 */
	async #attemptAcquireLease() {
		const { newLeaderNodeId } =
			await this.#coordinateDriver.attemptAcquireLease(
				this.#workerId,
				this.#globalState.nodeId,
				this.#registryConfig.workerPeer.leaseDuration,
			);

		// Check if the lease was successfully acquired and promoted to leader
		const isPromoted =
			!this.#isLeader && newLeaderNodeId === this.#globalState.nodeId;

		// Save leader
		this.#leaderNodeId = newLeaderNodeId;

		// Promote as leader if needed
		if (isPromoted) {
			if (!this.#isLeader) throw new Error("assert: should be promoted");

			this.#convertToLeader();
		}
	}

	async removeConnectionReference(connId: string) {
		const removed = this.#referenceConnections.delete(connId);

		if (removed) {
			logger().debug("removed worker reference", {
				workerId: this.#workerId,
				connId,
				newReferenceCount: this.#referenceConnections.size,
			});
		} else {
			logger().warn("removed reference to worker that didn't exist", {
				workerId: this.#workerId,
				connId,
			});
		}

		if (this.#referenceConnections.size === 0) {
			this.#dispose(true);
		}
	}

	async #dispose(releaseLease: boolean) {
		if (this.#isDisposed) return;
		this.#isDisposed = true;

		logger().info("worker shutting down", { workerId: this.#workerId });

		// IMPORTANT: Do this before anything async
		clearTimeout(this.#heartbeatTimeout);
		this.#globalState.workerPeers.delete(this.#workerId);

		// Stop worker
		//
		// We wait for this to finish to ensure that state is persisted safely to storage
		if (this.#isLeader && this.#loadedWorker) {
			await this.#loadedWorker.stop();
		}

		// Clear the lease if needed
		if (this.#isLeader && releaseLease) {
			await this.#coordinateDriver.releaseLease(
				this.#workerId,
				this.#globalState.nodeId,
			);
		}

		logger().info("worker shutdown success", { workerId: this.#workerId });
	}
}
