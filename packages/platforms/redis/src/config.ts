import type { AnyActorConstructor, BaseConfig } from "actor-core/platform";
import type { RedisOptions } from "ioredis";

export const DEFAULT_ACTOR_PEER_LEASE_DURATION = 3000;
export const DEFAULT_ACTOR_PEER_RENEW_LEASE_GRACE = 1500;
export const DEFAULT_ACTOR_PEER_CHECK_LEASE_INTERVAL = 1000;
export const DEFAULT_ACTOR_PEER_CHECK_LEASE_JITTER = 500;
export const DEFAULT_ACTOR_PEER_MESSAGE_ACK_TIMEOUT = 1000;

export interface RedisConfig extends BaseConfig {
	actors: Record<string, AnyActorConstructor>;
	redis?: Pick<
		RedisOptions,
		| "port"
		| "host"
		| "tls"
		| "socketTimeout"
		| "keepAlive"
		| "noDelay"
		| "connectionName"
		| "username"
		| "password"
		| "db"
		| "name"
		| "sentinels"
		| "role"
		| "preferredSlaves"
	>;
	actorPeer?: {
		/**
		 * How long the actor leader holds a lease for.
		 *
		 * Milliseconds
		 **/
		leaseDuration?: number;
		/**
		 * How long before the lease will expire to issue the renew command.
		 *
		 * Milliseconds
		 */
		renewLeaseGrace?: number;
		/**
		 * How frequently the followers check if the leader is still active.
		 *
		 * Milliseconds
		 */
		checkLeaseInterval?: number;
		/**
		 * Positive jitter for check lease interval
		 *
		 * Milliseconds
		 */
		checkLeaseJitter?: number;
		/**
		 * How long to wait for a message ack.
		 *
		 * Milliseconds
		 */
		messageAckTimeout?: number;
	};
}
