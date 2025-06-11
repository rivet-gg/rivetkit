import type { AnyWorkerDefinition } from "@/worker/definition";
import type { Encoding } from "@/worker/protocol/serde";
import type { WorkerQuery } from "@/manager/protocol/query";
import { type WorkerDefinitionActions } from "./worker-common";
import { type WorkerConn, WorkerConnRaw } from "./worker-conn";
import {
	ClientDriver,
	CREATE_WORKER_CONN_PROXY,
	type ClientRaw,
} from "./client";
import { logger } from "./log";
import invariant from "invariant";
import { assertUnreachable } from "@/worker/utils";

/**
 * Provides underlying functions for stateless {@link WorkerHandle} for action calls.
 * Similar to WorkerConnRaw but doesn't maintain a connection.
 *
 * @see {@link WorkerHandle}
 */
export class WorkerHandleRaw {
	#client: ClientRaw;
	#driver: ClientDriver;
	#encodingKind: Encoding;
	#workerQuery: WorkerQuery;
	#params: unknown;

	/**
	 * Do not call this directly.
	 *
	 * Creates an instance of WorkerHandleRaw.
	 *
	 * @protected
	 */
	public constructor(
		client: any,
		driver: ClientDriver,
		params: unknown,
		encodingKind: Encoding,
		workerQuery: WorkerQuery,
	) {
		this.#client = client;
		this.#driver = driver;
		this.#encodingKind = encodingKind;
		this.#workerQuery = workerQuery;
		this.#params = params;
	}

	/**
	 * Call a raw action. This method sends an HTTP request to invoke the named action.
	 *
	 * @see {@link WorkerHandle}
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
			this.#workerQuery,
			this.#encodingKind,
			this.#params,
			opts.name,
			opts.args,
			{ signal: opts.signal },
		);
	}

	/**
	 * Establishes a persistent connection to the worker.
	 *
	 * @template AD The worker class that this connection is for.
	 * @returns {WorkerConn<AD>} A connection to the worker.
	 */
	connect(): WorkerConn<AnyWorkerDefinition> {
		logger().debug("establishing connection from handle", {
			query: this.#workerQuery,
		});

		const conn = new WorkerConnRaw(
			this.#client,
			this.#driver,
			this.#params,
			this.#encodingKind,
			this.#workerQuery,
		);

		return this.#client[CREATE_WORKER_CONN_PROXY](
			conn,
		) as WorkerConn<AnyWorkerDefinition>;
	}

	/**
	 * Resolves the worker to get its unique worker ID
	 *
	 * @returns {Promise<string>} - A promise that resolves to the worker's ID
	 */
	async resolve({ signal }: { signal?: AbortSignal } = {}): Promise<string> {
		if (
			"getForKey" in this.#workerQuery ||
			"getOrCreateForKey" in this.#workerQuery
		) {
			// TODO:
			const workerId = await this.#driver.resolveWorkerId(
				undefined,
				this.#workerQuery,
				this.#encodingKind,
				this.#params,
				signal ? { signal } : undefined,
			);
			this.#workerQuery = { getForId: { workerId } };
			return workerId;
		} else if ("getForId" in this.#workerQuery) {
			// SKip since it's already resolved
			return this.#workerQuery.getForId.workerId;
		} else if ("create" in this.#workerQuery) {
			// Cannot create a handle with this query
			invariant(false, "workerQuery cannot be create");
		} else {
			assertUnreachable(this.#workerQuery);
		}
	}
}

/**
 * Stateless handle to a worker. Allows calling worker's remote procedure calls with inferred types
 * without establishing a persistent connection.
 *
 * @example
 * ```
 * const room = client.get<ChatRoom>(...etc...);
 * // This calls the action named `sendMessage` on the `ChatRoom` worker without a connection.
 * await room.sendMessage('Hello, world!');
 * ```
 *
 * Private methods (e.g. those starting with `_`) are automatically excluded.
 *
 * @template AD The worker class that this handle is for.
 * @see {@link WorkerHandleRaw}
 */
export type WorkerHandle<AD extends AnyWorkerDefinition> = Omit<
	WorkerHandleRaw,
	"connect"
> & {
	// Add typed version of WorkerConn (instead of using AnyWorkerDefinition)
	connect(): WorkerConn<AD>;
	// Resolve method returns the worker ID
	resolve(): Promise<string>;
} & WorkerDefinitionActions<AD>;
