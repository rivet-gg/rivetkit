// import { DurableObject } from "cloudflare:workers";
// import type { Registry, RunConfig, WorkerKey } from "@rivetkit/core";
// import { logger } from "./log";
// import { PartitionTopologyWorker } from "@rivetkit/core/topologies/partition";
// import {
// 	CloudflareDurableObjectGlobalState,
// 	CloudflareWorkersWorkerDriver,
// } from "./worker-driver";
// import { Bindings, CF_AMBIENT_ENV } from "./handler";
// import { ExecutionContext } from "hono";
//
// export const KEYS = {
// 	INITIALIZED: "rivetkit:initialized",
// 	NAME: "rivetkit:name",
// 	KEY: "rivetkit:key",
// 	INPUT: "rivetkit:input",
// 	PERSISTED_DATA: "rivetkit:data",
// };
//
// export interface WorkerHandlerInterface extends DurableObject {
// 	initialize(req: WorkerInitRequest): Promise<void>;
// }
//
// export interface WorkerInitRequest {
// 	name: string;
// 	key: WorkerKey;
// 	input?: unknown;
// }
//
// interface InitializedData {
// 	name: string;
// 	key: WorkerKey;
// }
//
// export type DurableObjectConstructor = new (
// 	...args: ConstructorParameters<typeof DurableObject<Bindings>>
// ) => DurableObject<Bindings>;
//
// interface LoadedWorker {
// 	workerTopology: PartitionTopologyWorker;
// }
//
// export function createWorkerDurableObject(
// 	registry: Registry<any>,
// 	runConfig: RunConfig,
// ): DurableObjectConstructor {
// 	const globalState = new CloudflareDurableObjectGlobalState();
//
// 	/**
// 	 * Startup steps:
// 	 * 1. If not already created call `initialize`, otherwise check KV to ensure it's initialized
// 	 * 2. Load worker
// 	 * 3. Start service requests
// 	 */
// 	return class WorkerHandler
// 		extends DurableObject<Bindings>
// 		implements WorkerHandlerInterface
// 	{
// 		#initialized?: InitializedData;
// 		#initializedPromise?: PromiseWithResolvers<void>;
//
// 		#worker?: LoadedWorker;
//
// 		async #loadWorker(): Promise<LoadedWorker> {
// 			// This is always called from another context using CF_AMBIENT_ENV
//
// 			// Wait for init
// 			if (!this.#initialized) {
// 				// Wait for init
// 				if (this.#initializedPromise) {
// 					await this.#initializedPromise.promise;
// 				} else {
// 					this.#initializedPromise = Promise.withResolvers();
// 					const res = await this.ctx.storage.get([
// 						KEYS.INITIALIZED,
// 						KEYS.NAME,
// 						KEYS.KEY,
// 					]);
// 					if (res.get(KEYS.INITIALIZED)) {
// 						const name = res.get(KEYS.NAME) as string;
// 						if (!name) throw new Error("missing worker name");
// 						const key = res.get(KEYS.KEY) as WorkerKey;
// 						if (!key) throw new Error("missing worker key");
//
// 						logger().debug("already initialized", { name, key });
//
// 						this.#initialized = { name, key };
// 						this.#initializedPromise.resolve();
// 					} else {
// 						logger().debug("waiting to initialize");
// 					}
// 				}
// 			}
//
// 			// Check if already loaded
// 			if (this.#worker) {
// 				return this.#worker;
// 			}
//
// 			if (!this.#initialized) throw new Error("Not initialized");
//
// 			// Configure worker driver
// 			runConfig.driver.worker = new CloudflareWorkersWorkerDriver(globalState);
//
// 			const workerTopology = new PartitionTopologyWorker(
// 				registry.config,
// 				runConfig,
// 			);
//
// 			// Register DO with global state
// 			// HACK: This leaks the DO context, but DO does not provide a native way
// 			// of knowing when the DO shuts down. We're making a broad assumption
// 			// that DO will boot a new isolate frequenlty enough that this is not an issue.
// 			const workerId = this.ctx.id.toString();
// 			globalState.setDOState(workerId, { ctx: this.ctx, env: this.env });
//
// 			// Save worker
// 			this.#worker = {
// 				workerTopology,
// 			};
//
// 			// Start worker
// 			await workerTopology.start(
// 				workerId,
// 				this.#initialized.name,
// 				this.#initialized.key,
// 				// TODO:
// 				"unknown",
// 			);
//
// 			return this.#worker;
// 		}
//
// 		/** RPC called by the service that creates the DO to initialize it. */
// 		async initialize(req: WorkerInitRequest) {
// 			// TODO: Need to add this to a core promise that needs to be resolved before start
//
// 			return await CF_AMBIENT_ENV.run(this.env, async () => {
// 				await this.ctx.storage.put({
// 					[KEYS.INITIALIZED]: true,
// 					[KEYS.NAME]: req.name,
// 					[KEYS.KEY]: req.key,
// 					[KEYS.INPUT]: req.input,
// 				});
// 				this.#initialized = {
// 					name: req.name,
// 					key: req.key,
// 				};
//
// 				logger().debug("initialized worker", { key: req.key });
//
// 				// Preemptively worker so the lifecycle hooks are called
// 				await this.#loadWorker();
// 			});
// 		}
//
// 		async fetch(request: Request): Promise<Response> {
// 			return await CF_AMBIENT_ENV.run(this.env, async () => {
// 				const { workerTopology } = await this.#loadWorker();
//
// 				const ctx = this.ctx;
// 				return await workerTopology.router.fetch(
// 					request,
// 					this.env,
// 					// Implement execution context so we can wait on requests
// 					{
// 						waitUntil(promise: Promise<unknown>) {
// 							ctx.waitUntil(promise);
// 						},
// 						passThroughOnException() {
// 							// Do nothing
// 						},
// 						props: {},
// 					} satisfies ExecutionContext,
// 				);
// 			});
// 		}
//
// 		async alarm(): Promise<void> {
// 			return await CF_AMBIENT_ENV.run(this.env, async () => {
// 				const { workerTopology } = await this.#loadWorker();
// 				await workerTopology.worker.onAlarm();
// 			});
// 		}
// 	};
// }
