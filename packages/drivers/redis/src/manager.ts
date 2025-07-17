import {
	type ActorRouter,
	createActorRouter,
	createClientWithDriver,
	createInlineClientDriver,
	type Encoding,
	type RegistryConfig,
	type RunConfig,
} from "@rivetkit/core";
import type {
	ActorDriver,
	ActorOutput,
	CreateInput,
	GetForIdInput,
	GetOrCreateWithKeyInput,
	GetWithKeyInput,
	ManagerDriver,
} from "@rivetkit/core/driver-helpers";
import { ActorAlreadyExists } from "@rivetkit/core/errors";
import { dbg, type UpgradeWebSocket } from "@rivetkit/core/utils";
import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import type { RedisGlobalState } from "./global-state";
import { logger } from "./log";
import { generateActorId } from "./utils";

// These types are not exported from @rivetkit/core, so we need to recreate them
type WSHandler = (ws: any) => void | Promise<void>;

class InlineWebSocketAdapter2 implements WebSocket {
	CLOSED = 3 as const;
	CLOSING = 2 as const;
	CONNECTING = 0 as const;
	OPEN = 1 as const;

	readyState = 0 as any;
	url = "";
	bufferedAmount = 0;
	extensions = "";
	protocol = "";
	binaryType: "blob" | "arraybuffer" = "blob";

	onclose = null;
	onerror = null;
	onmessage = null;
	onopen = null;

	constructor(handler: WSHandler) {
		// Implementation details omitted
	}

	close() {}
	send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {}
	addEventListener() {}
	removeEventListener() {}
	dispatchEvent(event: Event): boolean {
		return false;
	}
}

function noopNext() {
	return Promise.resolve();
}

export class RedisManagerDriver implements ManagerDriver {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#state: RedisGlobalState;

	#actorDriver: ActorDriver;
	#actorRouter: ActorRouter;

	// inspector: ManagerInspector = new ManagerInspector(this, {
	// 	getAllActors: () => this.#state.getAllActors(),
	// 	getAllTypesOfActors: () => Object.keys(this.registry.config.actors),
	// });

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		state: RedisGlobalState,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#state = state;

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
		// For now, return a dummy WebSocket
		// This would need proper implementation with Redis pub/sub
		throw new Error("WebSocket not implemented for Redis driver");
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
		// For now, throw an error as WebSocket is not implemented
		// This would need proper implementation with Redis pub/sub
		throw new Error("WebSocket not implemented for Redis driver");
	}

	async getForId({ actorId }: GetForIdInput): Promise<ActorOutput | undefined> {
		// Validate the actor exists
		if (!(await this.#state.hasActor(actorId))) {
			return undefined;
		}

		try {
			// Load actor state
			const state = await this.#state.loadActorState(actorId);

			return {
				actorId,
				name: state.name,
				key: state.key,
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
		if (await this.#state.hasActor(actorId)) {
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
		// First try to get the actor without locking
		const getOutput = await this.getWithKey(input);
		if (getOutput) {
			return getOutput;
		} else {
			return await this.createActor(input);
		}
	}

	async createActor({ name, key, input }: CreateInput): Promise<ActorOutput> {
		// Generate the deterministic actor ID
		const actorId = generateActorId(name, key);

		// Check if actor already exists
		if (await this.#state.hasActor(actorId)) {
			throw new ActorAlreadyExists(name, key);
		}

		await this.#state.createActor(actorId, name, key, input);

		// Notify inspector about actor changes
		// this.inspector.onActorsChange(this.#state.getAllActors());

		return {
			actorId,
			name,
			key,
		};
	}
}
