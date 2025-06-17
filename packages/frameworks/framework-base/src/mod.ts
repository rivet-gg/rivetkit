//import type {
//	WorkerConn,
//	WorkerAccessor,
//	ExtractAppFromClient,
//	ExtractWorkersFromApp,
//	ClientRaw,
//	AnyWorkerDefinition,
//} from "rivetkit/client";
//
///**
// * Shallow compare objects.
// * Copied from https://github.com/TanStack/query/blob/3c5d8e348cc53e46aea6c74767f3181fc77c2308/packages/query-core/src/utils.ts#L298-L299
// */
//export function shallowEqualObjects<
//	// biome-ignore lint/suspicious/noExplicitAny: we do not care about the shape
//	T extends Record<string, any>,
//>(a: T | undefined, b: T | undefined): boolean {
//	if (a === undefined && b === undefined) {
//		return true;
//	}
//	if (!a || !b || Object.keys(a).length !== Object.keys(b).length) {
//		return false;
//	}
//
//	for (const key in a) {
//		if (a[key] !== b[key]) {
//			if (typeof a[key] === "object" && typeof b[key] === "object") {
//				return shallowEqualObjects(a[key], b[key]);
//			}
//			return false;
//		}
//	}
//
//	return true;
//}
//
//namespace State {
//	export type Value<AD extends AnyWorkerDefinition> =
//		| { state: "init"; worker: undefined; isLoading: false }
//		| { state: "creating"; worker: undefined; isLoading: true }
//		| { state: "created"; worker: WorkerConn<AD>; isLoading: false }
//		| { state: "error"; error: unknown; worker: undefined; isLoading: false };
//
//	export const INIT = <AD extends AnyWorkerDefinition>(): Value<AD> => ({
//		state: "init",
//		worker: undefined,
//		isLoading: false,
//	});
//	export const CREATING = <AD extends AnyWorkerDefinition>(): Value<AD> => ({
//		state: "creating",
//		worker: undefined,
//		isLoading: true,
//	});
//	export const CREATED = <AD extends AnyWorkerDefinition>(
//		worker: WorkerConn<AD>,
//	): Value<AD> => ({
//		state: "created",
//		worker,
//		isLoading: false,
//	});
//	export const ERRORED = <AD extends AnyWorkerDefinition>(
//		error: unknown,
//	): Value<AD> => ({
//		state: "error",
//		worker: undefined,
//		error,
//		isLoading: false,
//	});
//}
//
//export class WorkerManager<
//	C extends ClientRaw,
//	Registry extends ExtractAppFromClient<C>,
//	Registry extends ExtractWorkersFromRegistry<Registry>,
//	WorkerName extends keyof Registry,
//	AD extends Registry[WorkerName],
//> {
//	#client: C;
//	#name: Exclude<WorkerName, symbol | number>;
//	#options: Parameters<WorkerAccessor<AD>["connect"]>;
//
//	#listeners: (() => void)[] = [];
//
//	#state: State.Value<AD> = State.INIT();
//
//	#createPromise: Promise<WorkerConn<AD>> | null = null;
//
//	constructor(
//		client: C,
//		name: Exclude<WorkerName, symbol | number>,
//		options: Parameters<WorkerAccessor<AD>["connect"]>,
//	) {
//		this.#client = client;
//		this.#name = name;
//		this.#options = options;
//	}
//
//	setOptions(options: Parameters<WorkerAccessor<AD>["connect"]>) {
//		if (shallowEqualObjects(options, this.#options)) {
//			if (!this.#state.worker) {
//				this.create();
//			}
//			return;
//		}
//
//		this.#state.worker?.dispose();
//
//		this.#state = { ...State.INIT() };
//		this.#options = options;
//		this.#update();
//		this.create();
//	}
//
//	async create() {
//		if (this.#createPromise) {
//			return this.#createPromise;
//		}
//		this.#state = { ...State.CREATING() };
//		this.#update();
//		try {
//			this.#createPromise = this.#client.connect(this.#name, ...this.#options);
//			const worker = (await this.#createPromise) as WorkerConn<AD>;
//			this.#state = { ...State.CREATED(worker) };
//			this.#createPromise = null;
//		} catch (e) {
//			this.#state = { ...State.ERRORED(e) };
//		} finally {
//			this.#update();
//		}
//	}
//
//	getState() {
//		return this.#state;
//	}
//
//	subscribe(cb: () => void) {
//		this.#listeners.push(cb);
//		return () => {
//			this.#listeners = this.#listeners.filter((l) => l !== cb);
//		};
//	}
//
//	#update() {
//		for (const cb of this.#listeners) {
//			cb();
//		}
//	}
//}
