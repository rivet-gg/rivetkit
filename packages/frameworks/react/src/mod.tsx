//"use client";
//import type {
//	ActorAccessor,
//	ActorConn,
//	ExtractAppFromClient,
//	ExtractActorsFromApp,
//	ClientRaw,
//} from "rivetkit/client";
//import { ActorManager } from "@rivetkit/framework-base";
//import {
//	useCallback,
//	useEffect,
//	useRef,
//	useState,
//	useSyncExternalStore,
//} from "react";
//
//export function createReactRivetKit<Client extends ClientRaw>(client: Client) {
//	type Registry = ExtractAppFromClient<Client>;
//	type Registry = ExtractActorsFromRegistry<Registry>;
//	return {
//		useActor: function useActor<
//			N extends keyof Registry,
//			AD extends Registry[N],
//		>(
//			name: Exclude<N, symbol | number>,
//			...options: Parameters<ActorAccessor<AD>["connect"]>
//		) {
//			const [manager] = useState(
//				() =>
//					new ActorManager<Client, Registry, Registry, N, AD>(client, name, options),
//			);
//
//			const state = useSyncExternalStore(
//				useCallback(
//					(onUpdate) => {
//						return manager.subscribe(onUpdate);
//					},
//					[manager],
//				),
//				() => manager.getState(),
//				() => manager.getState(),
//			);
//
//			useEffect(() => {
//				manager.setOptions(options);
//			}, [options, manager]);
//
//			return [state] as const;
//		},
//		useActorEvent<N extends keyof Registry, AD extends Registry[N]>(
//			opts: { actor: ActorConn<AD> | undefined; event: string },
//			cb: (...args: unknown[]) => void,
//		) {
//			const ref = useRef(cb);
//
//			useEffect(() => {
//				ref.current = cb;
//			}, [cb]);
//
//			useEffect(() => {
//				if (!opts.actor) {
//					return noop;
//				}
//				const unsub = opts.actor.on(opts.event, (...args: unknown[]) => {
//					ref.current(...args);
//				});
//
//				return unsub;
//			}, [opts.actor, opts.event]);
//		},
//	};
//}
//
//function noop() {
//	// noop
//}
