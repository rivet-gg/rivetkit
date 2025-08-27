import type { Client, ExtractActorsFromRegistry } from "@rivetkit/core/client";
import {
	type ActorOptions,
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
	>(opts: ActorOptions<Registry, ActorName>) {
		const { mount, setState, state } = getOrCreateActor<ActorName>(opts);

		// Create reactive state using Svelte 5 runes with proper typing
		type ActorConnection =
			ExtractActorsFromRegistry<Registry>[ActorName] extends {
				connection: infer C;
			}
				? C
				: any;
		type ActorHandle = ExtractActorsFromRegistry<Registry>[ActorName] extends {
			handle: infer H;
		}
			? H
			: any;

		let connection = $state<ActorConnection | null>(null);
		let handle = $state<ActorHandle | null>(null);
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
			// Subscribe to state changes from the base framework
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
					};
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
		) {
			// Get the current connection reactively
			const connection = $derived(state.state.connection);
			let connSubs: (() => void) | undefined;

			$effect.root(() => {
				// Set up event listener if connection exists
				connSubs = connection?.on(eventName, handler);

				// Cleanup function
				return () => {
					connSubs?.();
				};
			});
		}

		// Return reactive state with proper typing
		return {
			get connection(): ActorConnection | null {
				return connection;
			},
			get handle(): ActorHandle | null {
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
