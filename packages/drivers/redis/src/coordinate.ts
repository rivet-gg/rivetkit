import type {
	AttemptAcquireLease,
	CoordinateDriver,
	ExtendLeaseOutput,
	GetActorLeaderOutput,
	NodeMessageCallback,
	StartActorAndAcquireLeaseOutput,
} from "@rivetkit/core/driver-helpers";
import dedent from "dedent";
import type Redis from "ioredis";
import { KEYS, PUBSUB } from "./keys";

// Define custom commands for ioredis
declare module "ioredis" {
	interface RedisCommander {
		actorPeerAcquireLease(
			nodeKey: string,
			nodeId: string,
			leaseDuration: number,
		): Promise<string>;
		actorPeerExtendLease(
			nodeKey: string,
			nodeId: string,
			leaseDuration: number,
		): Promise<number>;
		actorPeerReleaseLease(nodeKey: string, nodeId: string): Promise<number>;
	}

	interface ChainableCommander {
		actorPeerAcquireLease(
			nodeKey: string,
			nodeId: string,
			leaseDuration: number,
		): this;
	}
}

export class RedisCoordinateDriver implements CoordinateDriver {
	#redis: Redis;
	#nodeSub?: Redis;

	constructor(redis: Redis) {
		this.#redis = redis;

		// Define Redis Lua scripts for atomic operations
		this.#defineRedisScripts();
	}

	async createNodeSubscriber(
		selfNodeId: string,
		callback: NodeMessageCallback,
	): Promise<void> {
		// Create a dedicated Redis connection for subscriptions
		this.#nodeSub = this.#redis.duplicate();

		// Configure message handler
		this.#nodeSub.on("message", (_channel: string, message: string) => {
			callback(message);
		});

		// Subscribe to node-specific channel
		await this.#nodeSub.subscribe(PUBSUB.node(selfNodeId));
	}

	async publishToNode(targetNodeId: string, message: string): Promise<void> {
		await this.#redis.publish(PUBSUB.node(targetNodeId), message);
	}

	async getActorLeader(actorId: string): Promise<GetActorLeaderOutput> {
		// Get current leader from Redis
		const [initialized, nodeId] = await this.#redis.mget([
			KEYS.ACTOR.initialized(actorId),
			KEYS.ACTOR.LEASE.node(actorId),
		]);

		if (!initialized) {
			return { actor: undefined };
		}

		return {
			actor: {
				leaderNodeId: nodeId || undefined,
			},
		};
	}

	async startActorAndAcquireLease(
		actorId: string,
		selfNodeId: string,
		leaseDuration: number,
	): Promise<StartActorAndAcquireLeaseOutput> {
		// Execute multi to get actor info and attempt to acquire lease in a single operation
		const execRes = await this.#redis
			.multi()
			.mget([KEYS.ACTOR.initialized(actorId), KEYS.ACTOR.metadata(actorId)])
			.actorPeerAcquireLease(
				KEYS.ACTOR.LEASE.node(actorId),
				selfNodeId,
				leaseDuration,
			)
			.exec();

		if (!execRes) {
			throw new Error("Redis transaction failed");
		}

		const [[mgetErr, mgetRes], [leaseErr, leaseRes]] = execRes;

		if (mgetErr) throw new Error(`Redis MGET error: ${mgetErr}`);
		if (leaseErr) throw new Error(`Redis acquire lease error: ${leaseErr}`);

		const [initialized, metadataRaw] = mgetRes as [
			string | null,
			string | null,
		];
		const leaderNodeId = leaseRes as unknown as string;

		if (!initialized) {
			return { actor: undefined };
		}

		// Parse metadata if present
		if (!metadataRaw)
			throw new Error("Actor should have metadata if initialized.");
		const metadata = JSON.parse(metadataRaw);

		return {
			actor: {
				name: metadata.name,
				key: metadata.key,
				leaderNodeId,
			},
		};
	}

	async extendLease(
		actorId: string,
		selfNodeId: string,
		leaseDuration: number,
	): Promise<ExtendLeaseOutput> {
		const res = await this.#redis.actorPeerExtendLease(
			KEYS.ACTOR.LEASE.node(actorId),
			selfNodeId,
			leaseDuration,
		);

		return {
			leaseValid: res === 1,
		};
	}

	async attemptAcquireLease(
		actorId: string,
		selfNodeId: string,
		leaseDuration: number,
	): Promise<AttemptAcquireLease> {
		const newLeaderNodeId = await this.#redis.actorPeerAcquireLease(
			KEYS.ACTOR.LEASE.node(actorId),
			selfNodeId,
			leaseDuration,
		);

		return {
			newLeaderNodeId,
		};
	}

	async releaseLease(actorId: string, nodeId: string): Promise<void> {
		await this.#redis.actorPeerReleaseLease(
			KEYS.ACTOR.LEASE.node(actorId),
			nodeId,
		);
	}

	#defineRedisScripts() {
		// Add custom Lua script commands to Redis
		this.#redis.defineCommand("actorPeerAcquireLease", {
			numberOfKeys: 1,
			lua: dedent`
                -- Get the current value of the key
                local currentValue = redis.call("get", KEYS[1])

                -- Return the current value if an entry already exists
                if currentValue then
                    return currentValue
                end

                -- Create an entry for the provided key
                redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2])

                -- Return the value to indicate the entry was added
                return ARGV[1]
            `,
		});

		this.#redis.defineCommand("actorPeerExtendLease", {
			numberOfKeys: 1,
			lua: dedent`
                -- Return 0 if an entry exists with a different lease holder
                if redis.call("get", KEYS[1]) ~= ARGV[1] then
                    return 0
                end

                -- Update the entry for the provided key
                redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2])

                -- Return 1 to indicate the entry was updated
                return 1
            `,
		});

		this.#redis.defineCommand("actorPeerReleaseLease", {
			numberOfKeys: 1,
			lua: dedent`
                -- Only remove the entry for this lock value
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    redis.pcall("del", KEYS[1])
                    return 1
                end

                -- Return 0 if no entry was removed.
                return 0
            `,
		});
	}
}
