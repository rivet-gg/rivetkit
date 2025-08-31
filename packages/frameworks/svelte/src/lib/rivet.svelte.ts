import type {
	ActorConn,
	ActorHandle,
	AnyActorDefinition,
	Client,
	ExtractActorsFromRegistry,
} from "@rivetkit/core/client";
import {
	type ActorOptions,
	type AnyActorRegistry,
	type CreateRivetKitOptions,
	createRivetKit as createVanillaRivetKit,
} from "@rivetkit/framework-base";
import { useStore } from "@tanstack/svelte-store";

export interface ActorStateReference<AD extends AnyActorDefinition> {
	/**
	 * The unique identifier for the actor.
	 * This is a hash generated from the actor's options.
	 * It is used to identify the actor instance in the store.
	 * @internal
	 */
	hash: string;
	/**
	 * The state of the actor, derived from the store.
	 * This includes the actor's connection and handle.
	 */
	handle: ActorHandle<AD> | null;
	/**
	 * The connection to the actor.
	 * This is used to communicate with the actor in realtime.
	 */
	connection: ActorConn<AD> | null;
	/**
	 * Whether the actor is enabled.
	 */
	isConnected?: boolean;
	/**
	 * Whether the actor is currently connecting, indicating that a connection attempt is in progress.
	 */
	isConnecting?: boolean;
	/**
	 * Whether there was an error connecting to the actor.
	 */
	isError?: boolean;
	/**
	 * The error that occurred while trying to connect to the actor, if any.
	 */
	error: Error | null;
	/**
	 * Options for the actor, including its name, key, parameters, and whether it is enabled.
	 */
	opts: {
		name: keyof AD;
		/**
		 * Unique key for the actor instance.
		 * This can be a string or an array of strings to create multiple instances.
		 * @example "abc" or ["abc", "def"]
		 */
		key: string | string[];
		/**
		 * Parameters for the actor.
		 * These are additional options that can be passed to the actor.
		 */
		params?: Record<string, string>;
		/** Region to create the actor in if it doesn't exist. */
		createInRegion?: string;
		/** Input data to pass to the actor. */
		createWithInput?: unknown;
		/**
		 * Whether the actor is enabled.
		 * Defaults to true.
		 */
		enabled?: boolean;
	};
}

export { createClient } from "@rivetkit/core/client";

export function createRivetKit<Registry extends AnyActorRegistry>(
	client: Client<Registry>,
	opts: CreateRivetKitOptions<Registry> = {},
) {
	const { getOrCreateActor } = createVanillaRivetKit<
		Registry,
		ExtractActorsFromRegistry<Registry>,
		keyof ExtractActorsFromRegistry<Registry>
	>(client, opts);

	/**
	 * Svelte 5 rune-based function to connect to an actor and retrieve its state.
	 * Using this function with the same options will return the same actor instance.
	 * This simplifies passing around the actor state in your components.
	 * It also provides a method to listen for events emitted by the actor.
	 * @param opts - Options for the actor, including its name, key, and parameters.
	 * @returns An object containing reactive state and event listener function.
	 */
	function useActor<
		ActorName extends keyof ExtractActorsFromRegistry<Registry>,
	>(
		opts: ActorOptions<Registry, ActorName>,
	): {
		current: Omit<
			ActorStateReference<ExtractActorsFromRegistry<Registry>>,
			"handle" | "connection"
		> & {
			handle: ActorHandle<
				ExtractActorsFromRegistry<Registry>[ActorName]
			> | null;
			connection: ActorConn<
				ExtractActorsFromRegistry<Registry>[ActorName]
			> | null;
		};
		useEvent: (eventName: string, handler: (...args: any[]) => void) => void;
	} {
		const { mount, setState, state } = getOrCreateActor<ActorName>(opts);

		// Update options reactively
		$effect.root(() => {
			setState((prev) => {
				prev.opts = {
					...opts,
					enabled: opts.enabled ?? true,
				} as any;
				return prev;
			});
		});

		// Mount and subscribe to state changes
		$effect.root(() => {
			mount();
		});
		const actorState = useStore(state);

		function useEvent(
			eventName: string,
			// biome-ignore lint/suspicious/noExplicitAny: strong typing of handler is not supported yet
			handler: (...args: any[]) => void,
		) {
			let ref = $state(handler);
			const actorState = useStore(state) || {};

			$effect(() => {
				ref = handler;
			});
			$effect(() => {
				if (!actorState?.current?.connection) return;
				function eventHandler(...args: any[]) {
					ref(...args);
				}
				return actorState.current.connection.on(eventName, eventHandler);
			});
		}

		const current = {
			get connection() {
				return actorState.current?.connection;
			},
			get handle() {
				return actorState.current?.handle;
			},
			get isConnected() {
				return actorState.current?.isConnected;
			},
			get isConnecting() {
				return actorState.current?.isConnecting;
			},
			get isError() {
				return actorState.current?.isError;
			},
			get error() {
				return actorState.current?.error;
			},
			get opts() {
				return actorState.current?.opts;
			},
			get hash() {
				return actorState.current?.hash;
			},
		};
		return {
			current,
			useEvent,
		};
	}

	return {
		useActor,
	};
}
