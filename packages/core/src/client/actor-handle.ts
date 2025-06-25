import type { AnyActorDefinition } from "@/actor/definition";
import type { Encoding } from "@/actor/protocol/serde";
import { assertUnreachable } from "@/actor/utils";
import type { ActorQuery } from "@/manager/protocol/query";
import invariant from "invariant";
import type { ActorDefinitionActions } from "./actor-common";
import { type ActorConn, ActorConnRaw } from "./actor-conn";
import {
	CREATE_ACTOR_CONN_PROXY,
	type ClientDriver,
	type ClientRaw,
} from "./client";
import { logger } from "./log";

/**
 * Provides underlying functions for stateless {@link ActorHandle} for action calls.
 * Similar to ActorConnRaw but doesn't maintain a connection.
 *
 * @see {@link ActorHandle}
 */
export class ActorHandleRaw {
	#client: ClientRaw;
	#driver: ClientDriver;
	#encodingKind: Encoding;
	#actorQuery: ActorQuery;
	#params: unknown;

	/**
	 * Do not call this directly.
	 *
	 * Creates an instance of ActorHandleRaw.
	 *
	 * @protected
	 */
	public constructor(
		client: any,
		driver: ClientDriver,
		params: unknown,
		encodingKind: Encoding,
		actorQuery: ActorQuery,
	) {
		this.#client = client;
		this.#driver = driver;
		this.#encodingKind = encodingKind;
		this.#actorQuery = actorQuery;
		this.#params = params;
	}

	/**
	 * Call a raw action. This method sends an HTTP request to invoke the named action.
	 *
	 * @see {@link ActorHandle}
	 * @template Args - The type of arguments to pass to the action function.
	 * @template Response - The type of the response returned by the action function.
	 */
	async action<
		Args extends Array<unknown> = unknown[],
		Response = unknown,
	>(opts: {
		name: string;
		args: Args;
		signal?: AbortSignal;
	}): Promise<Response> {
		return await this.#driver.action<Args, Response>(
			undefined,
			this.#actorQuery,
			this.#encodingKind,
			this.#params,
			opts.name,
			opts.args,
			{ signal: opts.signal },
		);
	}

	/**
	 * Establishes a persistent connection to the actor.
	 *
	 * @template AD The actor class that this connection is for.
	 * @returns {ActorConn<AD>} A connection to the actor.
	 */
	connect(): ActorConn<AnyActorDefinition> {
		logger().debug("establishing connection from handle", {
			query: this.#actorQuery,
		});

		const conn = new ActorConnRaw(
			this.#client,
			this.#driver,
			this.#params,
			this.#encodingKind,
			this.#actorQuery,
		);

		return this.#client[CREATE_ACTOR_CONN_PROXY](
			conn,
		) as ActorConn<AnyActorDefinition>;
	}

	/**
	 * Resolves the actor to get its unique actor ID
	 *
	 * @returns {Promise<string>} - A promise that resolves to the actor's ID
	 */
	async resolve({ signal }: { signal?: AbortSignal } = {}): Promise<string> {
		if (
			"getForKey" in this.#actorQuery ||
			"getOrCreateForKey" in this.#actorQuery
		) {
			// TODO:
			const actorId = await this.#driver.resolveActorId(
				undefined,
				this.#actorQuery,
				this.#encodingKind,
				this.#params,
				signal ? { signal } : undefined,
			);
			this.#actorQuery = { getForId: { actorId } };
			return actorId;
		} else if ("getForId" in this.#actorQuery) {
			// SKip since it's already resolved
			return this.#actorQuery.getForId.actorId;
		} else if ("create" in this.#actorQuery) {
			// Cannot create a handle with this query
			invariant(false, "actorQuery cannot be create");
		} else {
			assertUnreachable(this.#actorQuery);
		}
	}
}

/**
 * Stateless handle to a actor. Allows calling actor's remote procedure calls with inferred types
 * without establishing a persistent connection.
 *
 * @example
 * ```
 * const room = client.get<ChatRoom>(...etc...);
 * // This calls the action named `sendMessage` on the `ChatRoom` actor without a connection.
 * await room.sendMessage('Hello, world!');
 * ```
 *
 * Private methods (e.g. those starting with `_`) are automatically excluded.
 *
 * @template AD The actor class that this handle is for.
 * @see {@link ActorHandleRaw}
 */
export type ActorHandle<AD extends AnyActorDefinition> = Omit<
	ActorHandleRaw,
	"connect"
> & {
	// Add typed version of ActorConn (instead of using AnyActorDefinition)
	connect(): ActorConn<AD>;
	// Resolve method returns the actor ID
	resolve(): Promise<string>;
} & ActorDefinitionActions<AD>;
