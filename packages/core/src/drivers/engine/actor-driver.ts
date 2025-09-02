import type {
	ActorConfig as RunnerActorConfig,
	RunnerConfig,
} from "@rivetkit/engine-runner";
import { Runner } from "@rivetkit/engine-runner";
import * as cbor from "cbor-x";
import { WSContext } from "hono/ws";
import invariant from "invariant";
import { EncodingSchema } from "@/actor/protocol/serde";
import type { Client } from "@/client/client";
import {
	type ActorDriver,
	type AnyActorInstance,
	HEADER_AUTH_DATA,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
	type ManagerDriver,
	serializeEmptyPersistData,
} from "@/driver-helpers/mod";
import type {
	ActorRouter,
	RegistryConfig,
	RunConfig,
	UniversalWebSocket,
	UpgradeWebSocketArgs,
} from "@/mod";
import {
	createActorRouter,
	createGenericConnDrivers,
	GenericConnGlobalState,
	handleRawWebSocketHandler,
	handleWebSocketConnect,
	lookupInRegistry,
	noopNext,
	PATH_CONNECT_WEBSOCKET,
	PATH_RAW_WEBSOCKET_PREFIX,
} from "@/mod";
import type { Config } from "./config";
import { deserializeActorKey } from "./keys";
import { KEYS } from "./kv";
import { logger } from "./log";

interface ActorHandler {
	actor?: AnyActorInstance;
	actorStartPromise?: PromiseWithResolvers<void>;
	genericConnGlobalState: GenericConnGlobalState;
	persistedData?: Uint8Array;
}

export type DriverContext = {};

export class EngineActorDriver implements ActorDriver {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#managerDriver: ManagerDriver;
	#inlineClient: Client<any>;
	#config: Config;
	#runner: Runner;
	#actors: Map<string, ActorHandler> = new Map();
	#actorRouter: ActorRouter;
	#version: number = 1; // Version for the runner protocol

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		managerDriver: ManagerDriver,
		inlineClient: Client<any>,
		config: Config,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#managerDriver = managerDriver;
		this.#inlineClient = inlineClient;
		this.#config = config;
		this.#actorRouter = createActorRouter(runConfig, this);

		// Create runner configuration
		let hasDisconnected = false;
		const runnerConfig: RunnerConfig = {
			version: this.#version,
			endpoint: config.endpoint,
			pegboardEndpoint: config.pegboardEndpoint,
			namespace: config.namespace,
			addresses: config.addresses,
			totalSlots: config.totalSlots,
			runnerName: config.runnerName,
			runnerKey: config.runnerKey,
			prepopulateActorNames: Object.keys(this.#registryConfig.use),
			onConnected: () => {
				if (hasDisconnected) {
					logger().info("runner reconnected", {
						namespace: this.#config.namespace,
						runnerName: this.#config.runnerName,
					});
				} else {
					logger().debug("runner connected", {
						namespace: this.#config.namespace,
						runnerName: this.#config.runnerName,
					});
				}
			},
			onDisconnected: () => {
				logger().warn("runner disconnected", {
					namespace: this.#config.namespace,
					runnerName: this.#config.runnerName,
				});
				hasDisconnected = true;
			},
			fetch: this.#runnerFetch.bind(this),
			websocket: this.#runnerWebSocket.bind(this),
			onActorStart: this.#runnerOnActorStart.bind(this),
			onActorStop: this.#runnerOnActorStop.bind(this),
		};

		// Create and start runner
		this.#runner = new Runner(runnerConfig);
		this.#runner.start();
		logger().debug("engine runner started", {
			endpoint: config.endpoint,
			namespace: config.namespace,
			runnerName: config.runnerName,
		});
	}

	async #loadActorHandler(actorId: string): Promise<ActorHandler> {
		// Check if actor is already loaded
		const handler = this.#actors.get(actorId);
		if (!handler) throw new Error(`Actor handler does not exist ${actorId}`);
		if (handler.actorStartPromise) await handler.actorStartPromise.promise;
		if (!handler.actor) throw new Error("Actor should be loaded");
		return handler;
	}

	async loadActor(actorId: string): Promise<AnyActorInstance> {
		const handler = await this.#loadActorHandler(actorId);
		if (!handler.actor) throw new Error(`Actor ${actorId} failed to load`);
		return handler.actor;
	}

	getGenericConnGlobalState(actorId: string): GenericConnGlobalState {
		const handler = this.#actors.get(actorId);
		if (!handler) {
			throw new Error(`Actor ${actorId} not loaded`);
		}
		return handler.genericConnGlobalState;
	}

	getContext(actorId: string): DriverContext {
		return {};
	}

	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		const handler = this.#actors.get(actorId);
		if (!handler) throw new Error(`Actor ${actorId} not loaded`);
		if (handler.persistedData) return handler.persistedData;

		const [value] = await this.#runner.kvGet(actorId, [KEYS.PERSIST_DATA]);

		if (value !== null) {
			handler.persistedData = value;
			return value;
		} else {
			return undefined;
		}
	}

	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		const handler = this.#actors.get(actorId);
		if (!handler) throw new Error(`Actor ${actorId} not loaded`);

		handler.persistedData = data;

		await this.#runner.kvPut(actorId, [[KEYS.PERSIST_DATA, data]]);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		// TODO: Set timeout
		// TODO: Use alarm on sleep
		// TODO: Send alarm to runner

		const delay = Math.max(timestamp - Date.now(), 0);
		setTimeout(() => {
			actor.onAlarm();
		}, delay);
	}

	async getDatabase(_actorId: string): Promise<unknown | undefined> {
		return undefined;
	}

	// Runner lifecycle callbacks
	async #runnerOnActorStart(
		actorId: string,
		generation: number,
		config: RunnerActorConfig,
	): Promise<void> {
		logger().debug("runner actor starting", {
			actorId,
			name: config.name,
			key: config.key,
			generation,
		});

		// Deserialize input
		let input: any;
		if (config.input) {
			input = cbor.decode(config.input);
		}

		// Get or create handler
		let handler = this.#actors.get(actorId);
		if (!handler) {
			handler = {
				genericConnGlobalState: new GenericConnGlobalState(),
				actorStartPromise: Promise.withResolvers(),
				persistedData: serializeEmptyPersistData(input),
			};
			this.#actors.set(actorId, handler);
		}

		const name = config.name as string;
		invariant(config.key, "actor should have a key");
		const key = deserializeActorKey(config.key);

		// Create actor instance
		const definition = lookupInRegistry(
			this.#registryConfig,
			config.name as string, // TODO: Remove cast
		);
		handler.actor = definition.instantiate();

		// Start actor
		const connDrivers = createGenericConnDrivers(
			handler.genericConnGlobalState,
		);
		await handler.actor.start(
			connDrivers,
			this,
			this.#inlineClient,
			actorId,
			name,
			key,
			"unknown", // TODO: Add regions
		);

		// Resolve promise if waiting
		handler.actorStartPromise?.resolve();
		handler.actorStartPromise = undefined;

		logger().debug("runner actor started", { actorId, name, key });
	}

	async #runnerOnActorStop(actorId: string, generation: number): Promise<void> {
		logger().debug("runner actor stopping", { actorId, generation });

		const handler = this.#actors.get(actorId);
		if (handler?.actor) {
			await handler.actor.stop();
			this.#actors.delete(actorId);
		}

		logger().debug("runner actor stopped", { actorId });
	}

	async #runnerFetch(actorId: string, request: Request): Promise<Response> {
		logger().debug("runner fetch", {
			actorId,
			url: request.url,
			method: request.method,
		});
		return await this.#actorRouter.fetch(request, { actorId });
	}

	async #runnerWebSocket(
		actorId: string,
		websocketRaw: any,
		request: Request,
	): Promise<void> {
		const websocket = websocketRaw as UniversalWebSocket;

		logger().debug("runner websocket", { actorId, url: request.url });

		const url = new URL(request.url);

		// Parse headers
		const encodingRaw = request.headers.get(HEADER_ENCODING);
		const connParamsRaw = request.headers.get(HEADER_CONN_PARAMS);
		const authDataRaw = request.headers.get(HEADER_AUTH_DATA);

		const encoding = EncodingSchema.parse(encodingRaw);
		const connParams = connParamsRaw ? JSON.parse(connParamsRaw) : undefined;
		const authData = authDataRaw ? JSON.parse(authDataRaw) : undefined;

		// Fetch WS handler
		//
		// We store the promise since we need to add WebSocket event listeners immediately that will wait for the promise to resolve
		let wsHandlerPromise: Promise<UpgradeWebSocketArgs>;
		if (url.pathname === PATH_CONNECT_WEBSOCKET) {
			wsHandlerPromise = handleWebSocketConnect(
				request,
				this.#runConfig,
				this,
				actorId,
				encoding,
				connParams,
				authData,
			);
		} else if (url.pathname.startsWith(PATH_RAW_WEBSOCKET_PREFIX)) {
			wsHandlerPromise = handleRawWebSocketHandler(
				request,
				url.pathname + url.search,
				this,
				actorId,
				authData,
			);
		} else {
			throw new Error(`Unreachable path: ${url.pathname}`);
		}

		// TODO: Add close

		// Connect the Hono WS hook to the adapter
		const wsContext = new WSContext(websocket);

		wsHandlerPromise.catch((err) => {
			logger().error("building websocket handlers errored", { err });
			wsContext.close(1011, `${err}`);
		});

		if (websocket.readyState === 1) {
			wsHandlerPromise.then((x) => x.onOpen?.(new Event("open"), wsContext));
		} else {
			websocket.addEventListener("open", (event) => {
				wsHandlerPromise.then((x) => x.onOpen?.(event, wsContext));
			});
		}

		websocket.addEventListener("message", (event) => {
			wsHandlerPromise.then((x) => x.onMessage?.(event, wsContext));
		});

		websocket.addEventListener("close", (event) => {
			wsHandlerPromise.then((x) => x.onClose?.(event, wsContext));
		});

		websocket.addEventListener("error", (event) => {
			wsHandlerPromise.then((x) => x.onError?.(event, wsContext));
		});
	}

	async shutdown(immediate: boolean): Promise<void> {
		logger().info("stopping engine actor driver");
		await this.#runner.shutdown(immediate);
	}
}
