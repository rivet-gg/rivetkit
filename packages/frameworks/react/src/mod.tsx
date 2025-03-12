"use client";
import type { ActorHandle, Client } from "actor-core/client";
import { ActorManager } from "@actor-core/framework-base";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";

const ActorCoreClientContext = createContext<Client | null>(null);

interface ActorCoreClientProviderProps {
	client: Client;
	children: ReactNode;
}

export function ActorCoreClientProvider({
	client,
	children,
}: ActorCoreClientProviderProps) {
	return (
		<ActorCoreClientContext.Provider value={client}>
			{children}
		</ActorCoreClientContext.Provider>
	);
}

export function useActorCoreClient() {
	const client = useContext(ActorCoreClientContext);
	if (client === null) {
		throw new Error(
			"useActorCoreClient must be used within an ActorCoreClientProvider",
		);
	}
	return client;
}

export function useActor<A = unknown>(...options: Parameters<Client["get"]>) {
	const client = useActorCoreClient();

	const [manager] = useState(() => new ActorManager<A>(client, options));

	const state = useSyncExternalStore(
		useCallback(
			(onUpdate) => {
				return manager.subscribe(onUpdate);
			},
			[manager],
		),
		() => manager.getState(),
		() => manager.getState(),
	);

	useEffect(() => {
		manager.setOptions(options);
	}, [options, manager]);

	return [state] as const;
}

export function useActorEvent<
	A = unknown,
	// biome-ignore lint/suspicious/noExplicitAny: we do not care about the shape of the args, for now
	Args extends any[] = unknown[],
>(
	opts: { actor: ActorHandle<A> | null; event: string },
	cb: (...args: Args) => void,
) {
	const ref = useRef(cb);

	useEffect(() => {
		ref.current = cb;
	}, [cb]);

	useEffect(() => {
		if (!opts.actor) {
			return noop;
		}
		const unsub = opts.actor.on(opts.event, (...args: Args) => {
			ref.current(...args);
		});

		return unsub;
	}, [opts.actor, opts.event]);
}

function noop() {
	// noop
}
