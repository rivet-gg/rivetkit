import {
	RedisConfig,
	DEFAULT_ACTOR_PEER_CHECK_LEASE_INTERVAL,
	DEFAULT_ACTOR_PEER_CHECK_LEASE_JITTER,
	DEFAULT_ACTOR_PEER_LEASE_DURATION,
	DEFAULT_ACTOR_PEER_RENEW_LEASE_GRACE,
} from "@/config";
import type { AnyActor } from "actor-core/platform";
import { GlobalState } from "@/router/mod";
import { logger } from "@/log";
import Redis from "ioredis";
import { buildActorLeaderDriver } from "./driver";
import { Actor, ActorTags } from "actor-core";
import { KEYS } from "@/redis";

export class ActorPeer {
	#redis: Redis;
	#config: RedisConfig;
	#globalState: GlobalState;
	#actorId: string;
	#tags?: ActorTags;
	#isDisposed = false;

	/** Connections that hold a reference to this actor. If this set is empty, the actor should be shut down. */
	#referenceConnections = new Set<string>();

	/** Node ID that's the leader for this actor. */
	#leaderNodeId?: string;

	/** Holds the insantiated actor class if is leader. */
	#loadedActor?: Actor;

	#heartbeatTimeout?: NodeJS.Timeout;

	get #isLeader() {
		return this.#leaderNodeId === this.#globalState.nodeId;
	}

	get leaderNodeId() {
		if (!this.#leaderNodeId) throw new Error("Not found leader node ID yet");
		return this.#leaderNodeId;
	}

	constructor(
		redis: Redis,
		config: RedisConfig,
		globalState: GlobalState,
		actorId: string,
	) {
		this.#redis = redis;
		this.#config = config;
		this.#globalState = globalState;
		this.#actorId = actorId;
	}

	/** Acquires a `ActorPeer` for a connection and includes the connection ID in the references. */
	static async acquire(
		redis: Redis,
		config: RedisConfig,
		globalState: GlobalState,
		actorId: string,
		connId: string,
	): Promise<ActorPeer> {
		let peer = globalState.actorPeers.get(actorId);

		// Create peer if needed
		if (!peer) {
			peer = new ActorPeer(redis, config, globalState, actorId);
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

	static getLeaderActor(
		globalState: GlobalState,
		actorId: string,
	): AnyActor | undefined {
		const peer = globalState.actorPeers.get(actorId);
		if (!peer) return undefined;
		if (peer.#isLeader) {
			const actor = peer.#loadedActor;
			if (!actor)
				throw new Error("Actor is leader, but loadedActor is undefined");
			return actor;
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
		// TODO: Remove actor from globalState

		// TODO: Add back NX
		// Acquire lease

		// TODO: Do this in 1 round trip with a Lua script

		// Acquire initial information
		const execRes = await this.#redis
			.multi()
			.mget([
				KEYS.ACTOR.initialized(this.#actorId),
				KEYS.ACTOR.tags(this.#actorId),
			])
			.actorPeerAcquireLease(
				KEYS.ACTOR.LEASE.node(this.#actorId),
				this.#globalState.nodeId,
				this.#config.actorPeer?.leaseDuration ??
					DEFAULT_ACTOR_PEER_LEASE_DURATION,
			)
			.exec();
		if (!execRes) throw new Error("Exec returned null");

		const [[mgetErr, mgetRes], [leaseErr, leaseRes]] = execRes;

		if (mgetErr) throw new Error(`Redis MGET error: ${mgetErr}`);
		if (!mgetRes) throw new Error("MGET is null");
		const [initialized, tagsRaw] = mgetRes as [string, string];

		if (leaseErr) throw new Error(`Redis acquire lease error: ${leaseErr}`);
		const leaseNode = leaseRes as string;

		// Log
		logger().debug("starting actor peer", {
			actorId: this.#actorId,
			initialized,
			node: leaseNode,
		});

		// Validate actor exists
		if (!initialized || !tagsRaw) {
			throw new Error("Actor does not exist");
		}

		// Parse tags
		const tags = JSON.parse(tagsRaw);
		this.#tags = tags;

		// Handle leadership
		this.#leaderNodeId = leaseNode;
		if (leaseNode === this.#globalState.nodeId) {
			logger().debug("actor peer is leader", {
				actorId: this.#actorId,
				leaderNodeId: leaseNode,
			});

			await this.#convertToLeader();
		} else {
			logger().debug("actor peer is follower", {
				actorId: this.#actorId,
				leaderNodeId: leaseNode,
			});

			this.#leaderNodeId = leaseNode;
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
				(this.#config.actorPeer?.leaseDuration ??
					DEFAULT_ACTOR_PEER_LEASE_DURATION) -
				(this.#config.actorPeer?.renewLeaseGrace ??
					DEFAULT_ACTOR_PEER_RENEW_LEASE_GRACE);
		} else {
			// TODO: Add jitter
			hbTimeout =
				(this.#config.actorPeer?.checkLeaseInterval ??
					DEFAULT_ACTOR_PEER_CHECK_LEASE_INTERVAL) +
				Math.random() *
					(this.#config.actorPeer?.checkLeaseJitter ??
						DEFAULT_ACTOR_PEER_CHECK_LEASE_JITTER);
		}
		if (hbTimeout < 0)
			throw new Error("Actor peer heartbeat timeout is negative, check config");
		this.#heartbeatTimeout = setTimeout(this.#heartbeat.bind(this), hbTimeout);
	}

	async #convertToLeader() {
		if (!this.#tags) throw new Error("missing tags");

		logger().debug("peer acquired leadership", { actorId: this.#actorId });

		// Build actor
		const actorName = this.#tags.name;
		const prototype = this.#config.actors[actorName];
		if (!prototype) throw new Error(`no actor for name ${prototype}`);

		// Create leader actor
		const actor = new (prototype as any)() as Actor;
		this.#loadedActor = actor;

		await actor.__start(
			buildActorLeaderDriver(
				this.#redis,
				this.#globalState,
				this.#actorId,
				actor,
			),
			this.#actorId,
			this.#tags,
			"unknown",
		);
	}

	/**
	 * Extends the lease if the current leader. Called on an interval for leaders leader.
	 *
	 * If the lease has expired for any reason (e.g. connection latency or database purged), this will automatically shut down the actor.
	 */
	async #extendLease() {
		const res = await this.#redis.actorPeerExtendLease(
			KEYS.ACTOR.LEASE.node(this.#actorId),
			this.#globalState.nodeId,
			this.#config.actorPeer?.leaseDuration ??
				DEFAULT_ACTOR_PEER_LEASE_DURATION,
		);
		if (res === 0) {
			logger().debug("lease is invalid", { actorId: this.#actorId });

			// Shut down. SInce the lease is already lost, no need to clear it.
			await this.#dispose(false);
		} else if (res === 1) {
			logger().debug("lease is valid", { actorId: this.#actorId });
		} else {
			throw new Error(`Unexpected extendLease res: ${res}`);
		}
	}

	/**
	 * Attempts to acquire a lease (aka checks if the leader's lease has expired). Called on an interval for followers.
	 */
	async #attemptAcquireLease() {
		const newLeaderNodeId = await this.#redis.actorPeerAcquireLease(
			KEYS.ACTOR.LEASE.node(this.#actorId),
			this.#globalState.nodeId,
			this.#config.actorPeer?.leaseDuration ??
				DEFAULT_ACTOR_PEER_LEASE_DURATION,
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
			this.#dispose(true);
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
			await this.#loadedActor.__stop();
		}

		// Clear the lease if needed
		if (this.#isLeader && releaseLease) {
			await this.#redis.actorPeerReleaseLease(
				KEYS.ACTOR.LEASE.node(this.#actorId),
				this.#globalState.nodeId,
			);
		}

		logger().info("actor shutdown success", { actorId: this.#actorId });
	}
}
