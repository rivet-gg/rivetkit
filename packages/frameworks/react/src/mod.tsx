"use client";
import type {
	ActorAccessor,
	ActorConn,
	ExtractAppFromClient,
	ExtractActorsFromApp,
	ClientRaw,
} from "actor-core/client";
import { ActorManager } from "@actor-core/framework-base";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

export function createReactActorCore<Client extends ClientRaw>(client: Client) {
	type App = ExtractAppFromClient<Client>;
	type Registry = ExtractActorsFromApp<App>;
	return {
		useActor: function useActor<
			N extends keyof Registry,
			AD extends Registry[N],
		>(
			name: Exclude<N, symbol | number>,
			...options: Parameters<ActorAccessor<AD>["connect"]>
		) {
			const [manager] = useState(
				() =>
					new ActorManager<Client, App, Registry, N, AD>(client, name, options),
			);

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
		},
		useActorEvent<N extends keyof Registry, AD extends Registry[N]>(
			opts: { actor: ActorConn<AD> | undefined; event: string },
			cb: (...args: unknown[]) => void,
		) {
			const ref = useRef(cb);

			useEffect(() => {
				ref.current = cb;
			}, [cb]);

			useEffect(() => {
				if (!opts.actor) {
					return noop;
				}
				const unsub = opts.actor.on(opts.event, (...args: unknown[]) => {
					ref.current(...args);
				});

				return unsub;
			}, [opts.actor, opts.event]);
		},
	};
}

function noop() {
	// noop
}
