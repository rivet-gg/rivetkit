import {
	type ActorKey,
	type AnyActorInstance,
	createGenericConnDrivers,
	GenericConnGlobalState,
	type Registry,
	type RegistryConfig,
	type RunConfig,
} from "@rivetkit/core";
import type { ActorDriver } from "@rivetkit/core/driver-helpers";
import type { CoordinateDriverConfig } from "./config";
import type { CoordinateDriver } from "./driver";
import { logger } from "./log";
import type { GlobalState } from "./types";

export class ActorPeer {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#driverConfig: CoordinateDriverConfig;
	#coordinateDriver: CoordinateDriver;
	#actorDriver: ActorDriver;
	#inlineClient: any; // Client type
	#globalState: GlobalState;
	#actorId: string;
	#actorName?: string;
	#actorKey?: ActorKey;
	#isDisposed = false;

	/** Connections that hold a reference to this actor. If this set is empty, the actor should be shut down. */
	#referenceConnections = new Set<string>();

	/** Node ID that's the leader for this actor. */
	#leaderNodeId?: string;

	/** Holds the insantiated actor class if is leader. */
	#loadedActor?: AnyActorInstance;

	/** Promise that resolves when the actor has fully started (only for leaders) */
	#loadedActorStartingPromise?: Promise<void>;

	#heartbeatTimeout?: NodeJS.Timeout;

	// TODO: Only create this when becomse leader
	readonly genericConnGlobalState = new GenericConnGlobalState();

	get #isLeader() {
		return this.#leaderNodeId === this.#globalState.nodeId;
	}

	get isLeader() {
		return this.#isLeader;
	}

	get leaderNodeId() {
		if (!this.#leaderNodeId) throw new Error("Not found leader node ID yet");
		return this.#leaderNodeId;
	}

	get loadedActor() {
		return this.#loadedActor;
	}

	get loadedActorStartingPromise() {
		return this.#loadedActorStartingPromise;
	}

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		driverConfig: CoordinateDriverConfig,
		CoordinateDriver: CoordinateDriver,
		actorDriver: ActorDriver,
		inlineClient: any, // Client type
		globalState: GlobalState,
		actorId: string,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#driverConfig = driverConfig;
		this.#coordinateDriver = CoordinateDriver;
		this.#actorDriver = actorDriver;
		this.#inlineClient = inlineClient;
		this.#globalState = globalState;
		this.#actorId = actorId;
	}

	/** Acquires a `ActorPeer` for a connection and includes the connection ID in the references. */
	static async acquire(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		driverConfig: CoordinateDriverConfig,
		actorDriver: ActorDriver,
		inlineClient: any, // Client type
		CoordinateDriver: CoordinateDriver,
		globalState: GlobalState,
		actorId: string,
		connId: string,
	): Promise<ActorPeer> {
		let peer = globalState.actorPeers.get(actorId);

		// Create peer if needed
		if (!peer) {
			peer = new ActorPeer(
				registryConfig,
				runConfig,
				driverConfig,
				CoordinateDriver,
				actorDriver,
				inlineClient,
				globalState,
				actorId,
			);
			globalState.actorPeers.set(actorId, peer);
			await peer.#start();
		}

		peer.#referenceConnections.add(connId);

		logger().debug("added actor reference", {
			actorId,
			connId,
			newReferenceCount: peer.#referenceConnections.size,
		});

		return peer;
	}

	static getLeaderActorPeer(
		globalState: GlobalState,
		actorId: string,
	): ActorPeer | undefined {
		const peer = globalState.actorPeers.get(actorId);
		if (!peer) return undefined;

		if (peer.#isLeader) {
			return peer;
		} else {
			return undefined;
		}
	}

	static async getLeaderActor(
		globalState: GlobalState,
		actorId: string,
	): Promise<AnyActorInstance | undefined> {
		const peer = ActorPeer.getLeaderActorPeer(globalState, actorId);
		if (!peer) return undefined;

		// Wait for actor to be ready if it's still starting
		if (peer.loadedActorStartingPromise) {
			await peer.loadedActorStartingPromise;
		}

		const actor = peer.loadedActor;
		if (!actor)
			throw new Error("Actor is leader, but loadedActor is undefined");
		return actor;
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
		// TODO: Remove actor from globalState

		// TODO: Add back NX
		// Acquire lease

		// TODO: Do this in 1 round trip with a Lua script

		// Acquire initial information
		const { actor } = await this.#coordinateDriver.startActorAndAcquireLease(
			this.#actorId,
			this.#globalState.nodeId,
			this.#driverConfig.actorPeer.leaseDuration,
		);
		// Log
		logger().debug("starting actor peer", {
			actor,
		});

		// Validate actor exists
		if (!actor) {
			throw new Error("Actor does not exist");
		}

		// Parse tags
		this.#actorName = actor.name;
		this.#actorKey = actor.key;

		// Handle leadership
		this.#leaderNodeId = actor.leaderNodeId;
		if (actor.leaderNodeId === this.#globalState.nodeId) {
			logger().debug("actor peer is leader", {
				actorId: this.#actorId,
				leaderNodeId: actor.leaderNodeId,
			});

			await this.#convertToLeader();
		} else {
			logger().debug("actor peer is follower", {
				actorId: this.#actorId,
				leaderNodeId: actor.leaderNodeId,
			});

			this.#leaderNodeId = actor.leaderNodeId;
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
				this.#driverConfig.actorPeer.leaseDuration -
				this.#driverConfig.actorPeer.renewLeaseGrace;
		} else {
			// TODO: Add jitter
			hbTimeout =
				this.#driverConfig.actorPeer.checkLeaseInterval +
				Math.random() * this.#driverConfig.actorPeer.checkLeaseJitter;
		}
		if (hbTimeout < 0)
			throw new Error("Actor peer heartbeat timeout is negative, check config");
		this.#heartbeatTimeout = setTimeout(this.#heartbeat.bind(this), hbTimeout);
	}

	async #convertToLeader() {
		if (!this.#actorName || !this.#actorKey)
			throw new Error("missing name or key");

		logger().debug("peer acquired leadership", { actorId: this.#actorId });

		// Build actor
		const actorName = this.#actorName;
		const definition = this.#registryConfig.use[actorName];
		if (!definition)
			throw new Error(`no actor definition for name ${definition}`);

		// Create leader actor
		const actor = definition.instantiate();
		this.#loadedActor = actor;

		// Create promise to track actor startup
		this.#loadedActorStartingPromise = (async () => {
			// Start actor
			const connDrivers = createGenericConnDrivers(this.genericConnGlobalState);
			await actor.start(
				connDrivers,
				this.#actorDriver,
				this.#inlineClient,
				this.#actorId,
				this.#actorName!,
				this.#actorKey!,
				"unknown",
			);
		})();

		// Wait for actor to start
		await this.#loadedActorStartingPromise;
	}

	/**
	 * Extends the lease if the current leader. Called on an interval for leaders leader.
	 *
	 * If the lease has expired for any reason (e.g. connection latency or database purged), this will automatically shut down the actor.
	 */
	async #extendLease() {
		const { leaseValid } = await this.#coordinateDriver.extendLease(
			this.#actorId,
			this.#globalState.nodeId,
			this.#driverConfig.actorPeer.leaseDuration,
		);
		if (leaseValid) {
			logger().trace("lease is valid", { actorId: this.#actorId });
		} else {
			logger().debug("lease is invalid", { actorId: this.#actorId });

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
				this.#actorId,
				this.#globalState.nodeId,
				this.#driverConfig.actorPeer.leaseDuration,
			);

		// Check if the lease was successfully acquired and promoted to leader
		const isPromoted =
			!this.#isLeader && newLeaderNodeId === this.#globalState.nodeId;

		// Check if leader changed (and we're not the new leader)
		const leaderChanged = this.#leaderNodeId !== newLeaderNodeId && !isPromoted;

		// Save leader
		this.#leaderNodeId = newLeaderNodeId;

		// If leader changed, close all WebSockets for this actor
		if (leaderChanged) {
			this.#closeAllWebSockets();
		}

		// Promote as leader if needed
		if (isPromoted) {
			if (!this.#isLeader) throw new Error("assert: should be promoted");

			await this.#convertToLeader();
		}
	}

	async removeConnectionReference(connId: string) {
		const removed = this.#referenceConnections.delete(connId);

		if (removed) {
			logger().debug("removed actor reference", {
				actorId: this.#actorId,
				connId,
				newReferenceCount: this.#referenceConnections.size,
			});
		} else {
			logger().warn("removed reference to actor that didn't exist", {
				actorId: this.#actorId,
				connId,
			});
		}

		if (this.#referenceConnections.size === 0) {
			await this.#dispose(true);
		}
	}

	#closeAllWebSockets() {
		logger().info("closing all websockets due to leader change", {
			actorId: this.#actorId,
		});

		// Close all relay WebSockets (used by openWebSocket)
		const relayWebSockets = (this.#globalState as any).relayWebSockets as
			| Map<string, any>
			| undefined;
		if (relayWebSockets) {
			for (const [wsId, ws] of relayWebSockets) {
				// Check if this WebSocket belongs to this actor
				if (ws.actorId === this.#actorId) {
					ws._handleClose(1001, "Actor leader changed");
					relayWebSockets.delete(wsId);
				}
			}
		}

		// Close all follower WebSockets (used by proxyWebSocket)
		const followerWebSockets = (this.#globalState as any).followerWebSockets as
			| Map<string, any>
			| undefined;
		if (followerWebSockets) {
			for (const [wsId, wsData] of followerWebSockets) {
				// Check if this WebSocket belongs to this actor
				if (wsData.actorId === this.#actorId) {
					wsData.ws.close(1001, "Actor leader changed");
					followerWebSockets.delete(wsId);
				}
			}
		}

		// Close all leader WebSockets (WebSockets we're handling as leader)
		const leaderWebSockets = (this.#globalState as any).leaderWebSockets as
			| Map<string, any>
			| undefined;
		if (leaderWebSockets) {
			for (const [wsId, wsData] of leaderWebSockets) {
				if (wsData.actorId === this.#actorId) {
					// Send close to follower
					if (wsData.wsContext && wsData.wsContext.close) {
						wsData.wsContext.close(1001, "Actor leader changed");
					}
					leaderWebSockets.delete(wsId);
				}
			}
		}
	}

	async #dispose(releaseLease: boolean) {
		if (this.#isDisposed) return;
		this.#isDisposed = true;

		logger().info("actor shutting down", { actorId: this.#actorId });

		// IMPORTANT: Do this before anything async
		clearTimeout(this.#heartbeatTimeout);
		this.#globalState.actorPeers.delete(this.#actorId);

		// Stop actor
		//
		// We wait for this to finish to ensure that state is persisted safely to storage
		if (this.#isLeader && this.#loadedActor) {
			await this.#loadedActor.stop();
		}

		// Clear the lease if needed
		if (this.#isLeader && releaseLease) {
			await this.#coordinateDriver.releaseLease(
				this.#actorId,
				this.#globalState.nodeId,
			);
		}

		logger().info("actor shutdown success", { actorId: this.#actorId });
	}
}
