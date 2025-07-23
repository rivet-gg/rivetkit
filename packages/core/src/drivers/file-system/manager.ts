import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import { type ActorRouter, createActorRouter } from "@/actor/router";
import {
	handleRawWebSocketHandler,
	handleWebSocketConnect,
} from "@/actor/router-endpoints";
import { createClientWithDriver } from "@/client/client";
import { InlineWebSocketAdapter2 } from "@/common/inline-websocket-adapter2";
import { noopNext } from "@/common/utils";
import type {
	ActorDriver,
	ActorOutput,
	CreateInput,
	GetForIdInput,
	GetOrCreateWithKeyInput,
	GetWithKeyInput,
	ManagerDriver,
} from "@/driver-helpers/mod";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import { ManagerInspector } from "@/inspector/manager";
import { type Actor, ActorFeature, type ActorId } from "@/inspector/mod";
import {
	type Encoding,
	PATH_CONNECT_WEBSOCKET,
	PATH_RAW_WEBSOCKET_PREFIX,
	type RegistryConfig,
	type RunConfig,
} from "@/mod";
import type { ActorState, FileSystemGlobalState } from "./global-state";
import { logger } from "./log";
import { generateActorId } from "./utils";

export class FileSystemManagerDriver implements ManagerDriver {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#state: FileSystemGlobalState;

	#actorDriver: ActorDriver;
	#actorRouter: ActorRouter;

	inspector?: ManagerInspector;

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		state: FileSystemGlobalState,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#state = state;

		if (runConfig.studio.enabled) {
			if (!this.#runConfig.studio.token()) {
				this.#runConfig.studio.token = () =>
					this.#state.getOrCreateInspectorAccessToken();
			}
			const startedAt = new Date().toISOString();
			function transformActor(actorState: ActorState): Actor {
				return {
					id: actorState.id as ActorId,
					name: actorState.name,
					key: actorState.key,
					startedAt: startedAt,
					createdAt:
						actorState.createdAt?.toISOString() || new Date().toISOString(),
					features: [
						ActorFeature.State,
						ActorFeature.Connections,
						ActorFeature.Console,
						ActorFeature.EventsMonitoring,
						ActorFeature.Database,
					],
				};
			}

			this.inspector = new ManagerInspector(() => {
				return {
					getAllActors: async ({ cursor, limit }) => {
						const itr = this.#state.getActorsIterator({ cursor });
						const actors: Actor[] = [];

						for await (const actor of itr) {
							actors.push(transformActor(actor));
							if (limit && actors.length >= limit) {
								break;
							}
						}
						return actors;
					},
					getActorById: async (id) => {
						try {
							const result = await this.#state.loadActorStateOrError(id);
							return transformActor(result);
						} catch {
							return null;
						}
					},
					getBuilds: async () => {
						return Object.keys(this.#registryConfig.use).map((name) => ({
							name,
						}));
					},
					createActor: async (input) => {
						const { actorId } = await this.createActor(input);
						try {
							const result = await this.#state.loadActorStateOrError(actorId);
							return transformActor(result);
						} catch {
							return null;
						}
					},
				};
			});
		}

		// Actors run on the same node as the manager, so we create a dummy actor router that we route requests to
		const inlineClient = createClientWithDriver(createInlineClientDriver(this));
		this.#actorDriver = runConfig.driver.actor(
			registryConfig,
			runConfig,
			this,
			inlineClient,
		);
		this.#actorRouter = createActorRouter(this.#runConfig, this.#actorDriver);
	}

	async sendRequest(actorId: string, actorRequest: Request): Promise<Response> {
		return await this.#actorRouter.fetch(actorRequest, {
			actorId,
		});
	}

	async openWebSocket(
		path: string,
		actorId: string,
		encoding: Encoding,
		params: unknown,
	): Promise<WebSocket> {
		// TODO:

		// Handle raw WebSocket paths
		if (path === PATH_CONNECT_WEBSOCKET) {
			// Handle standard connect
			const wsHandler = await handleWebSocketConnect(
				undefined,
				this.#runConfig,
				this.#actorDriver,
				actorId,
				encoding,
				params,
				undefined,
			);
			return new InlineWebSocketAdapter2(wsHandler);
		} else if (path.startsWith(PATH_RAW_WEBSOCKET_PREFIX)) {
			// Handle websocket proxy
			const wsHandler = await handleRawWebSocketHandler(
				undefined,
				path,
				this.#actorDriver,
				actorId,
				undefined,
			);
			return new InlineWebSocketAdapter2(wsHandler);
		} else {
			throw new Error(`Unreachable path: ${path}`);
		}
	}

	async proxyRequest(
		c: HonoContext,
		actorRequest: Request,
		actorId: string,
	): Promise<Response> {
		return await this.#actorRouter.fetch(actorRequest, {
			actorId,
		});
	}

	async proxyWebSocket(
		c: HonoContext,
		path: string,
		actorId: string,
		encoding: Encoding,
		connParams: unknown,
		authData: unknown,
	): Promise<Response> {
		const upgradeWebSocket = this.#runConfig.getUpgradeWebSocket?.();
		invariant(upgradeWebSocket, "missing getUpgradeWebSocket");

		// Handle raw WebSocket paths
		if (path === PATH_CONNECT_WEBSOCKET) {
			// Handle standard connect
			const wsHandler = await handleWebSocketConnect(
				undefined,
				this.#runConfig,
				this.#actorDriver,
				actorId,
				encoding,
				connParams,
				authData,
			);

			return upgradeWebSocket(() => wsHandler)(c, noopNext());
		} else if (path.startsWith(PATH_RAW_WEBSOCKET_PREFIX)) {
			// Handle websocket proxy
			const wsHandler = await handleRawWebSocketHandler(
				c,
				path,
				this.#actorDriver,
				actorId,
				authData,
			);

			return upgradeWebSocket(() => wsHandler)(c, noopNext());
		} else {
			throw new Error(`Unreachable path: ${path}`);
		}
	}

	async getForId({ actorId }: GetForIdInput): Promise<ActorOutput | undefined> {
		// Validate the actor exists
		const actor = await this.#state.loadActor(actorId);
		if (!actor.state) {
			return undefined;
		}

		try {
			// Load actor state
			return {
				actorId,
				name: actor.state.name,
				key: actor.state.key,
			};
		} catch (error) {
			logger().error("failed to read actor state", { actorId, error });
			return undefined;
		}
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<ActorOutput | undefined> {
		// Generate the deterministic actor ID
		const actorId = generateActorId(name, key);

		// Check if actor exists
		const actor = await this.#state.loadActor(actorId);
		if (actor.state) {
			return {
				actorId,
				name,
				key,
			};
		}

		return undefined;
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<ActorOutput> {
		// Generate the deterministic actor ID
		const actorId = generateActorId(input.name, input.key);

		// Use the atomic getOrCreateActor method
		const actorEntry = await this.#state.loadOrCreateActor(
			actorId,
			input.name,
			input.key,
			input.input,
		);
		invariant(actorEntry.state, "must have state");

		return {
			actorId: actorEntry.state.id,
			name: actorEntry.state.name,
			key: actorEntry.state.key,
		};
	}

	async createActor({ name, key, input }: CreateInput): Promise<ActorOutput> {
		// Generate the deterministic actor ID
		const actorId = generateActorId(name, key);

		await this.#state.createActor(actorId, name, key, input);

		return {
			actorId,
			name,
			key,
		};
	}

	extraStartupLog() {
		return {
			actors: this.#state.actorCountOnStartup,
			data: this.#state.storagePath,
		};
	}
}
