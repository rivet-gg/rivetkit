import type * as _rivetkit_core_client from "@rivetkit/core/client";
import type { Client, ExtractActorsFromRegistry } from "@rivetkit/core/client";
import {
	type ActorOptions,
	type ActorsStateDerived,
	type AnyActorRegistry,
	type CreateRivetKitOptions,
	createRivetKit as createVanillaRivetKit,
} from "@rivetkit/framework-base";
import { BROWSER } from "esm-env";

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
		connection: _rivetkit_core_client.ActorConn<
			ExtractActorsFromRegistry<Registry>[ActorName]
		> | null;
		handle: _rivetkit_core_client.ActorHandle<
			ExtractActorsFromRegistry<Registry>[ActorName]
		> | null;
		isConnected: boolean | undefined;
		isConnecting: boolean | undefined;
		actorOpts: {
			name: keyof ExtractActorsFromRegistry<Registry>;
			key: string | string[];
			params?: Record<string, string>;
			enabled?: boolean;
		};
		isError: boolean | undefined;
		error: Error | null;
		hash: string;
		useEvent: (eventName: string, handler: (...args: any[]) => void) => void;
	} {
		const { mount, setState, state } = getOrCreateActor<ActorName>(opts);

		let connection = $state<_rivetkit_core_client.ActorConn<
			ExtractActorsFromRegistry<Registry>[ActorName]
		> | null>(null);
		let handle = $state<_rivetkit_core_client.ActorHandle<
			ExtractActorsFromRegistry<Registry>[ActorName]
		> | null>(null);
		let isConnected = $state<boolean | undefined>(false);
		let isConnecting = $state<boolean | undefined>(false);
		let actorOpts = $state<{
			name: keyof ExtractActorsFromRegistry<Registry>;
			key: string | string[];
			params?: Record<string, string>;
			enabled?: boolean;
		}>({} as any);

		let isError = $state<boolean | undefined>(undefined);

		let error = $state<Error | null>(null);
		let hash = $state<string>("");

		// Only run in browser to avoid SSR issues
		if (BROWSER) {
			state.subscribe((newData) => {
				connection = newData.currentVal.connection;
				handle = newData.currentVal.handle;
				isConnected = newData.currentVal.isConnected;
				isConnecting = newData.currentVal.isConnecting;
				actorOpts = newData.currentVal.opts;
				isError = newData.currentVal.isError;
				error = newData.currentVal.error;
				hash = newData.currentVal.hash;
			});

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
		}

		/**
		 * Function to listen for events emitted by the actor.
		 * This function allows you to subscribe to specific events emitted by the actor
		 * and execute a handler function when the event occurs.
		 * It automatically manages the event listener lifecycle.
		 * @param eventName The name of the event to listen for.
		 * @param handler The function to call when the event is emitted.
		 */
		function useEvent(
			eventName: string,
			// biome-ignore lint/suspicious/noExplicitAny: strong typing of handler is not supported yet
			handler: (...args: any[]) => void,
		): void {
			const connection = $derived<_rivetkit_core_client.ActorConn<
				ExtractActorsFromRegistry<Registry>[ActorName]
			> | null>(state.state.connection);

			let connSubs: any;
			$effect.root(() => {
				connSubs = connection?.on(eventName, handler);
				// Cleanup function
				return () => {
					connSubs?.();
				};
			});
		}

		return {
			get connection() {
				return connection;
			},
			get handle() {
				return handle;
			},
			get isConnected() {
				return isConnected;
			},
			get isConnecting() {
				return isConnecting;
			},
			get actorOpts() {
				return actorOpts;
			},
			get isError() {
				return isError;
			},
			get error() {
				return error;
			},
			get hash() {
				return hash;
			},
			useEvent,
		};
	}

	return {
		useActor,
	};
}
