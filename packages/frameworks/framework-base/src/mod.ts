import type { ActorHandle, Client as ActorClient } from "actor-core/client";

/**
 * Shallow compare objects.
 * Copied from https://github.com/TanStack/query/blob/3c5d8e348cc53e46aea6c74767f3181fc77c2308/packages/query-core/src/utils.ts#L298-L299
 */
export function shallowEqualObjects<
	// biome-ignore lint/suspicious/noExplicitAny: we do not care about the shape
	T extends Record<string, any>,
>(a: T | undefined, b: T | undefined): boolean {
	if (a === undefined && b === undefined) {
		return true;
	}
	if (!a || !b || Object.keys(a).length !== Object.keys(b).length) {
		return false;
	}

	for (const key in a) {
		if (a[key] !== b[key]) {
			if (typeof a[key] === "object" && typeof b[key] === "object") {
				return shallowEqualObjects(a[key], b[key]);
			}
			return false;
		}
	}

	return true;
}

namespace State {
	export type Value<A> =
		| { state: "init"; actor: undefined; isLoading: false }
		| { state: "creating"; actor: undefined; isLoading: true }
		| { state: "created"; actor: ActorHandle<A>; isLoading: false }
		| { state: "error"; error: unknown; actor: undefined; isLoading: false };

	export const INIT = <A>(): Value<A> => ({
		state: "init",
		actor: undefined,
		isLoading: false,
	});
	export const CREATING = <A>(): Value<A> => ({
		state: "creating",
		actor: undefined,
		isLoading: true,
	});
	export const CREATED = <A>(actor: ActorHandle<A>): Value<A> => ({
		state: "created",
		actor,
		isLoading: false,
	});
	export const ERRORED = <A>(error: unknown): Value<A> => ({
		state: "error",
		actor: undefined,
		error,
		isLoading: false,
	});
}

export class ActorManager<A = unknown> {
	#client: ActorClient;
	#options: Parameters<ActorClient["get"]>;

	#listeners: (() => void)[] = [];

	#state: State.Value<A> = State.INIT();

	#createPromise: Promise<ActorHandle<A>> | null = null;

	constructor(client: ActorClient, options: Parameters<ActorClient["get"]>) {
		this.#client = client;
		this.#options = options;
	}

	setOptions(options: Parameters<ActorClient["get"]>) {
		if (shallowEqualObjects(options, this.#options)) {
			if (!this.#state.actor) {
				this.create();
			}
			return;
		}

		this.#state.actor?.disconnect();

		this.#state = { ...State.INIT() };
		this.#options = options;
		this.#update();
		this.create();
	}

	async create() {
		if (this.#createPromise) {
			return this.#createPromise;
		}
		this.#state = { ...State.CREATING() };
		this.#update();
		try {
			this.#createPromise = this.#client.get<A>(...this.#options);
			const actor = await this.#createPromise;
			this.#state = { ...State.CREATED(actor) };
			this.#createPromise = null;
		} catch (e) {
			this.#state = { ...State.ERRORED(e) };
		} finally {
			this.#update();
		}
	}

	getState() {
		return this.#state;
	}

	subscribe(cb: () => void) {
		this.#listeners.push(cb);
		return () => {
			this.#listeners = this.#listeners.filter((l) => l !== cb);
		};
	}

	#update() {
		for (const cb of this.#listeners) {
			cb();
		}
	}
}
