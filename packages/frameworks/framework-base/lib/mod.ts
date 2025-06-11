import { Derived, Effect, Store, type Updater } from "@tanstack/store";
import type { AnyWorkerDefinition, WorkerCoreApp } from "rivetkit";
import type {
	Client,
	ExtractWorkersFromApp,
	WorkerConn,
	WorkerHandle,
} from "rivetkit/client";

export type AnyWorkerRegistry = WorkerCoreApp<any>;

interface WorkerStateReference<AD extends AnyWorkerDefinition> {
	/**
	 * The unique identifier for the worker.
	 * This is a hash generated from the worker's options.
	 * It is used to identify the worker instance in the store.
	 * @internal
	 */
	hash: string;
	/**
	 * The state of the worker, derived from the store.
	 * This includes the worker's connection and handle.
	 */
	handle: WorkerHandle<AD> | null;
	/**
	 * The connection to the worker.
	 * This is used to communicate with the worker in realtime.
	 */
	connection: WorkerConn<AD> | null;
	/**
	 * Whether the worker is enabled.
	 */
	isConnected?: boolean;
	/**
	 * Whether the worker is currently connecting, indicating that a connection attempt is in progress.
	 */
	isConnecting?: boolean;
	/**
	 * Whether there was an error connecting to the worker.
	 */
	isError?: boolean;
	/**
	 * The error that occurred while trying to connect to the worker, if any.
	 */
	error: Error | null;
	/**
	 * Options for the worker, including its name, key, parameters, and whether it is enabled.
	 */
	opts: {
		name: keyof AD;
		/**
		 * Unique key for the worker instance.
		 * This can be a string or an array of strings to create multiple instances.
		 * @example "abc" or ["abc", "def"]
		 */
		key: string | string[];
		/**
		 * Parameters for the worker.
		 * These are additional options that can be passed to the worker.
		 */
		params?: Record<string, string>;
		/**
		 * Whether the worker is enabled.
		 * Defaults to true.
		 */
		enabled?: boolean;
	};
}

interface InternalRivetKitStore<
	Registry extends AnyWorkerRegistry,
	Workers extends ExtractWorkersFromApp<Registry>,
> {
	workers: Record<string, WorkerStateReference<Workers>>;
}

/**
 * Options for configuring a worker in RivetKit.
 */
export interface WorkerOptions<
	Registry extends AnyWorkerRegistry,
	WorkerName extends keyof ExtractWorkersFromApp<Registry>,
> {
	/**
	 * Typesafe name of the worker.
	 * This should match the worker's name in the app's worker definitions.
	 * @example "chatRoom"
	 */
	name: WorkerName;
	/**
	 * Unique key for the worker instance.
	 * This can be a string or an array of strings to create multiple instances.
	 * @example "abc" or ["abc", "def"]
	 */
	key: string | string[];
	/**
	 * Parameters for the worker.
	 */
	params?: Registry[ExtractWorkersFromApp<Registry>]["params"];
	/**
	 * Whether the worker is enabled.
	 * Defaults to true.
	 */
	enabled?: boolean;
}

export interface CreateRivetKitOptions<Registry extends AnyWorkerRegistry> {
	hashFunction?: (opts: WorkerOptions<Registry, any>) => string;
}

export function createRivetKit<
	Registry extends AnyWorkerRegistry,
	Workers extends ExtractWorkersFromApp<Registry>,
	WorkerNames extends keyof Workers,
>(client: Client<Registry>, opts: CreateRivetKitOptions<Registry> = {}) {
	type RivetKitStore = InternalRivetKitStore<Registry, Workers>;

	const store = new Store<RivetKitStore>({
		workers: {},
	});

	const hash = opts.hashFunction || defaultHashFunction;

	const cache = new Map<
		string,
		{
			state: Derived<RivetKitStore["workers"][string]>;
			key: string;
			mount: () => void;
			setState: (set: Updater<RivetKitStore["workers"][string]>) => void;
			create: () => void;
			addEventListener?: (
				event: string,
				handler: (...args: any[]) => void,
			) => void;
		}
	>();

	function getOrCreateWorker<WorkerName extends WorkerNames>(
		opts: WorkerOptions<Registry, WorkerName>,
	) {
		const key = hash(opts);
		const cached = cache.get(key);
		if (cached) {
			return {
				...cached,
				state: cached.state as Derived<
					Omit<RivetKitStore["workers"][string], "handle" | "connection"> & {
						handle: WorkerHandle<Workers[WorkerName]> | null;
						connection: WorkerConn<Workers[WorkerName]> | null;
					}
				>,
			};
		}

		const derived = new Derived({
			fn: ({ currDepVals: [store] }) => {
				return store.workers[key];
			},
			deps: [store],
		});

		function create() {
			async function createWorkerConnection() {
				const worker = store.state.workers[key];
				try {
					const handle = client.getOrCreate(
						worker.opts.name as string,
						worker.opts.key,
						worker.opts.params,
					);

					const connection = handle.connect();

					await handle.resolve(/*{ signal: AbortSignal.timeout(0) }*/);
					store.setState((prev) => {
						const prevWorker = prev.workers[key];
						prev.workers[key] = {
							...prevWorker,
							isConnected: true,
							isConnecting: false,
							handle: handle as WorkerHandle<Workers[WorkerName]>,
							connection: connection as WorkerConn<Workers[WorkerName]>,
							isError: false,
							error: null,
						};
						return prev;
					});
				} catch (error) {
					store.setState((prev) => {
						const prevWorker = prev.workers[key];
						prev.workers[key] = {
							...prevWorker,
							isError: true,
							isConnecting: false,
							error: error as Error,
						};

						return prev;
					});
				}
			}

			store.setState((prev) => {
				prev.workers[key].isConnecting = true;
				prev.workers[key].isError = false;
				prev.workers[key].error = null;
				createWorkerConnection();
				return prev;
			});
		}

		// connect effect
		const effect = new Effect({
			fn: () => {
				// check if prev state is different from current state
				// do a shallow comparison

				const worker = store.state.workers[key];

				const isSame =
					JSON.stringify(store.prevState.workers[key].opts) ===
					JSON.stringify(store.state.workers[key].opts);

				if (
					isSame &&
					!worker.isConnected &&
					!worker.isConnecting &&
					!worker.isError &&
					worker.opts.enabled
				) {
					create();
				}
			},
			deps: [derived],
		});

		store.setState((prev) => {
			if (prev.workers[key]) {
				return prev;
			}
			prev.workers[key] = {
				hash: key,
				isConnected: false,
				isConnecting: false,
				connection: null,
				handle: null,
				isError: false,
				error: null,
				opts,
			};
			return prev;
		});

		function setState(updater: Updater<RivetKitStore["workers"][string]>) {
			store.setState((prev) => {
				const worker = prev.workers[key];
				if (!worker) {
					throw new Error(`Worker with key "${key}" does not exist.`);
				}

				if (typeof updater === "function") {
					prev.workers[key] = updater(worker);
				} else {
					// If updater is a direct value, we assume it replaces the entire worker state
					prev.workers[key] = updater;
				}
				return prev;
			});
		}

		const mount = () => {
			const unsubscribeDerived = derived.mount();
			const unsubscribeEffect = effect.mount();

			return () => {
				unsubscribeDerived();
				unsubscribeEffect();
			};
		};

		cache.set(key, {
			state: derived,
			key,
			mount,
			setState,
			create,
			addEventListener,
		});

		return {
			mount,
			setState,
			state: derived as Derived<
				Omit<RivetKitStore["workers"][string], "handle" | "connection"> & {
					handle: WorkerHandle<Workers[WorkerName]> | null;
					connection: WorkerConn<Workers[WorkerName]> | null;
				}
			>,
			create,
			key,
		};
	}

	return {
		getOrCreateWorker,
		store,
	};
}

function defaultHashFunction({ name, key, params }: WorkerOptions<any, any>) {
	return JSON.stringify({ name, key, params });
}
