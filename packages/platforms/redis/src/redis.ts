import dedent from "dedent";
import Redis, { type Result, type Callback } from "ioredis";
import { RedisConfig } from "./config";

export const KEYS = {
	ACTOR: {
		// KEY
		initialized: (actorId: string) => `actor:${actorId}:initialized`,
		LEASE: {
			// KEY (expire) = node ID
			node: (actorId: string) => `actor:${actorId}:lease:node`,
		},
		// KEY
		tags: (actorId: string) => `actor:${actorId}:tags`,
		// KEY
		kv: (actorId: string, key: string) => `actor:${actorId}:kv:${key}`,
	},
};

export const PUBSUB = {
	node(nodeId: string) {
		return `node:${nodeId}:messages`;
	},
};


declare module "ioredis" {
	// Define custom commands
	//
	// See https://github.com/redis/ioredis/blob/49d1cf0cec9ad2f84bb5ea2e17dc6558c5b2cac7/examples/typescript/scripts.ts
	interface RedisCommander<Context> {
		actorPeerAcquireLease(
			nodeKey: string,
			nodeId: string,
			leaseDuration: number,
			callback?: Callback<string>,
		): Result<string, Context>;
		actorPeerExtendLease(
			nodeKey: string,
			nodeId: string,
			leaseDuration: number,
			callback?: Callback<number>,
		): Result<number, Context>;
		actorPeerReleaseLease(
			nodeKey: string,
			nodeId: string,
			callback?: Callback<number>,
		): Result<number, Context>;
	}
}

// TODO: allow this to reconnect gracefully with subscriptions
export function buildRedis(config: RedisConfig): Redis {
	return new Redis({
		...(config.redis ?? {}),
		scripts: {
			actorPeerAcquireLease: {
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
				numberOfKeys: 1,
			},
			actorPeerExtendLease: {
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
				numberOfKeys: 1,
			},
			actorPeerReleaseLease: {
				lua: dedent`
					-- Only remove the entry for this lock value
					if redis.call("get", KEYS[1]) == ARGV[1] then
						redis.pcall("del", KEYS[1])
						return 1
					end

					-- Return 0 if no entry was removed.
					return 0
				`,
				numberOfKeys: 1,
			},
		},
	});
}
