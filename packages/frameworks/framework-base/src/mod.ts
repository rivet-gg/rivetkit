import type {
	ActorHandle,
	ActorAccessor,
	AnyActorDefinition,
	ExtractAppFromClient,
	ExtractActorsFromApp,
	ClientRaw,
} from "actor-core/client";

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
	export type Value<AD extends AnyActorDefinition> =
		| { state: "init"; actor: undefined; isLoading: false }
		| { state: "creating"; actor: undefined; isLoading: true }
		| { state: "created"; actor: ActorHandle<AD>; isLoading: false }
		| { state: "error"; error: unknown; actor: undefined; isLoading: false };

	export const INIT = <AD extends AnyActorDefinition>(): Value<AD> => ({
		state: "init",
		actor: undefined,
		isLoading: false,
	});
	export const CREATING = <AD extends AnyActorDefinition>(): Value<AD> => ({
		state: "creating",
		actor: undefined,
		isLoading: true,
	});
	export const CREATED = <AD extends AnyActorDefinition>(
		actor: ActorHandle<AD>,
	): Value<AD> => ({
		state: "created",
		actor,
		isLoading: false,
	});
	export const ERRORED = <AD extends AnyActorDefinition>(
		error: unknown,
	): Value<AD> => ({
		state: "error",
		actor: undefined,
		error,
		isLoading: false,
	});
}

export class ActorManager<
	C extends ClientRaw,
	App extends ExtractAppFromClient<C>,
	Registry extends ExtractActorsFromApp<App>,
	ActorName extends keyof Registry,
	AD extends Registry[ActorName],
> {
	#client: C;
	#name: Exclude<ActorName, symbol | number>;
	#options: Parameters<ActorAccessor<AD>["get"]>;

	#listeners: (() => void)[] = [];

	#state: State.Value<AD> = State.INIT();

	#createPromise: Promise<ActorHandle<AD>> | null = null;

	constructor(
		client: C,
		name: Exclude<ActorName, symbol | number>,
		options: Parameters<ActorAccessor<AD>["get"]>,
	) {
		this.#client = client;
		this.#name = name;
		this.#options = options;
	}

	setOptions(options: Parameters<ActorAccessor<AD>["get"]>) {
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
			this.#createPromise = this.#client.get(this.#name, ...this.#options);
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
