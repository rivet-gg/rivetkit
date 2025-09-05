import * as cbor from "cbor-x";
import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import { ActorAlreadyExists } from "@/actor/errors";
import {
	HEADER_AUTH_DATA,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
	HEADER_EXPOSE_INTERNAL_ERROR,
} from "@/actor/router-endpoints";
import { generateRandomString } from "@/actor/utils";
import { importWebSocket } from "@/common/websocket";
import type {
	ActorOutput,
	CreateInput,
	GetForIdInput,
	GetOrCreateWithKeyInput,
	GetWithKeyInput,
	ManagerDriver,
} from "@/driver-helpers/mod";
import { type Encoding, noopNext, type RunConfig } from "@/mod";
import {
	createActor,
	destroyActor,
	getActor,
	getActorById,
	getOrCreateActorById,
} from "./api-endpoints";
import { EngineApiError } from "./api-utils";
import type { Config } from "./config";
import { deserializeActorKey, serializeActorKey } from "./keys";
import { logger } from "./log";
import { createWebSocketProxy } from "./ws-proxy";

export class EngineManagerDriver implements ManagerDriver {
	#config: Config;
	#runConfig: RunConfig;
	#importWebSocketPromise: Promise<typeof WebSocket>;

	constructor(config: Config, runConfig: RunConfig) {
		this.#config = config;
		this.#runConfig = runConfig;
		if (!this.#runConfig.inspector.token()) {
			const token = generateRandomString();
			this.#runConfig.inspector.token = () => token;
		}
		this.#importWebSocketPromise = importWebSocket();
	}

	async sendRequest(actorId: string, actorRequest: Request): Promise<Response> {
		logger().debug("sending request to actor via guard", {
			actorId,
			method: actorRequest.method,
			url: actorRequest.url,
		});

		return this.#forwardHttpRequest(actorRequest, actorId);
	}

	async openWebSocket(
		path: string,
		actorId: string,
		encoding: Encoding,
		params: unknown,
	): Promise<WebSocket> {
		const WebSocket = await this.#importWebSocketPromise;

		// WebSocket connections go through guard
		const guardUrl = `${this.#config.endpoint}${path}`;

		logger().debug("opening websocket to actor via guard", {
			actorId,
			path,
			guardUrl,
		});

		// Create WebSocket connection
		const ws = new WebSocket(guardUrl, {
			headers: buildGuardHeadersForWebSocket(actorId, encoding, params),
		});

		logger().debug("websocket connection opened", { actorId });

		return ws;
	}

	async proxyRequest(
		_c: HonoContext,
		actorRequest: Request,
		actorId: string,
	): Promise<Response> {
		logger().debug("forwarding request to actor via guard", {
			actorId,
			method: actorRequest.method,
			url: actorRequest.url,
			hasBody: !!actorRequest.body,
		});

		return this.#forwardHttpRequest(actorRequest, actorId);
	}

	async proxyWebSocket(
		c: HonoContext,
		path: string,
		actorId: string,
		encoding: Encoding,
		params: unknown,
		authData: unknown,
	): Promise<Response> {
		const upgradeWebSocket = this.#runConfig.getUpgradeWebSocket?.();
		invariant(upgradeWebSocket, "missing getUpgradeWebSocket");

		const guardUrl = `${this.#config.endpoint}${path}`;
		const wsGuardUrl = guardUrl.replace("http://", "ws://");

		logger().debug("forwarding websocket to actor via guard", {
			actorId,
			path,
			guardUrl,
		});

		// Build headers
		const headers = buildGuardHeadersForWebSocket(
			actorId,
			encoding,
			params,
			authData,
		);
		const args = await createWebSocketProxy(c, wsGuardUrl, headers);

		return await upgradeWebSocket(() => args)(c, noopNext());
	}

	extraStartupLog() {
		return {
			engine: this.#config.endpoint,
			namespace: this.#config.namespace,
			runner: this.#config.runnerName,
			address: Object.values(this.#config.addresses)
				.map((v) => `${v.host}:${v.port}`)
				.join(", "),
		};
	}

	async getForId({
		c,
		name,
		actorId,
	}: GetForIdInput): Promise<ActorOutput | undefined> {
		// Fetch from API if not in cache
		try {
			const response = await getActor(this.#config, actorId);

			// Validate name matches
			if (response.actor.name !== name) {
				logger().debug("actor name mismatch from api", {
					actorId,
					apiName: response.actor.name,
					requestedName: name,
				});
				return undefined;
			}

			const keyRaw = response.actor.key;
			invariant(keyRaw, `actor ${actorId} should have key`);
			const key = deserializeActorKey(keyRaw);

			return {
				actorId,
				name,
				key,
			};
		} catch (error) {
			if (
				error instanceof EngineApiError &&
				(error as EngineApiError).group === "actor" &&
				(error as EngineApiError).code === "not_found"
			) {
				return undefined;
			}
			throw error;
		}
	}

	async getWithKey({
		c,
		name,
		key,
	}: GetWithKeyInput): Promise<ActorOutput | undefined> {
		logger().debug("getWithKey: searching for actor", { name, key });

		// If not in local cache, fetch by key from API
		try {
			const response = await getActorById(this.#config, name, key);

			if (!response.actor_id) {
				return undefined;
			}

			const actorId = response.actor_id;

			logger().debug("getWithKey: found actor via api", {
				actorId,
				name,
				key,
			});

			return {
				actorId,
				name,
				key,
			};
		} catch (error) {
			if (
				error instanceof EngineApiError &&
				(error as EngineApiError).group === "actor" &&
				(error as EngineApiError).code === "not_found"
			) {
				return undefined;
			}
			throw error;
		}
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<ActorOutput> {
		const { c, name, key, input: actorInput, region } = input;

		logger().info(
			"getOrCreateWithKey: getting or creating actor via engine api",
			{
				name,
				key,
			},
		);

		const response = await getOrCreateActorById(this.#config, {
			name,
			key: serializeActorKey(key),
			runner_name_selector: this.#config.runnerName,
			input: input ? cbor.encode(actorInput).toString("base64") : undefined,
			crash_policy: "sleep",
		});

		const actorId = response.actor_id;

		logger().info("getOrCreateWithKey: actor ready", {
			actorId,
			name,
			key,
			created: response.created,
		});

		return {
			actorId,
			name,
			key,
		};
	}

	async createActor({
		c,
		name,
		key,
		input,
	}: CreateInput): Promise<ActorOutput> {
		// Check if actor with the same name and key already exists
		const existingActor = await this.getWithKey({ c, name, key });
		if (existingActor) {
			throw new ActorAlreadyExists(name, key);
		}

		logger().info("creating actor via engine api", { name, key });

		// Create actor via engine API
		const result = await createActor(this.#config, {
			name,
			runner_name_selector: this.#config.runnerName,
			key: serializeActorKey(key),
			input: input ? cbor.encode(input).toString("base64") : null,
			crash_policy: "sleep",
		});
		const actorId = result.actor.actor_id;

		logger().info("actor created", { actorId, name, key });

		return {
			actorId,
			name,
			key,
		};
	}

	async destroyActor(actorId: string): Promise<void> {
		logger().info("destroying actor via engine api", { actorId });

		await destroyActor(this.#config, actorId);

		logger().info("actor destroyed", { actorId });
	}

	async #forwardHttpRequest(
		actorRequest: Request,
		actorId: string,
	): Promise<Response> {
		// Route through guard port
		const url = new URL(actorRequest.url);
		const guardUrl = `${this.#config.endpoint}${url.pathname}${url.search}`;

		// Handle body properly based on method and presence
		let bodyToSend: ArrayBuffer | null = null;
		const guardHeaders = buildGuardHeadersForHttp(actorRequest, actorId);

		if (
			actorRequest.body &&
			actorRequest.method !== "GET" &&
			actorRequest.method !== "HEAD"
		) {
			if (actorRequest.bodyUsed) {
				throw new Error("Request body has already been consumed");
			}

			// TODO: This buffers the entire request in memory every time. We
			// need to properly implement streaming bodies.
			// Clone and read the body to ensure it can be sent
			const clonedRequest = actorRequest.clone();
			bodyToSend = await clonedRequest.arrayBuffer();

			// If this is a streaming request, we need to convert the headers
			// for the basic array buffer
			guardHeaders.delete("transfer-encoding");
			guardHeaders.set(
				"content-length",
				String((bodyToSend as ArrayBuffer).byteLength),
			);
		}

		const guardRequest = new Request(guardUrl, {
			method: actorRequest.method,
			headers: guardHeaders,
			body: bodyToSend,
		});

		return mutableResponse(await fetch(guardRequest));
	}
}

function mutableResponse(fetchRes: Response): Response {
	// We cannot return the raw response from `fetch` since the response type is not mutable.
	//
	// In order for middleware to be able to mutate the response, we need to build a new Response object that is mutable.
	return new Response(fetchRes.body, fetchRes);
}

function buildGuardHeadersForHttp(
	actorRequest: Request,
	actorId: string,
): Headers {
	const headers = new Headers();
	// Copy all headers from the original request
	for (const [key, value] of actorRequest.headers.entries()) {
		headers.set(key, value);
	}
	// Add guard-specific headers
	headers.set("x-rivet-target", "actor");
	headers.set("x-rivet-actor", actorId);
	headers.set("x-rivet-port", "main");
	return headers;
}

function buildGuardHeadersForWebSocket(
	actorId: string,
	encoding: Encoding,
	params?: unknown,
	authData?: unknown,
): Record<string, string> {
	const headers: Record<string, string> = {};
	headers["x-rivet-target"] = "actor";
	headers["x-rivet-actor"] = actorId;
	headers["x-rivet-port"] = "main";
	headers[HEADER_EXPOSE_INTERNAL_ERROR] = "true";
	headers[HEADER_ENCODING] = encoding;
	if (params) {
		headers[HEADER_CONN_PARAMS] = JSON.stringify(params);
	}
	if (authData) {
		headers[HEADER_AUTH_DATA] = JSON.stringify(authData);
	}
	return headers;
}
