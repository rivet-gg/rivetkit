import type { Client, ExtractActorsFromRegistry } from "@rivetkit/actor/client";
import {
	type ActorOptions,
	type AnyActorRegistry,
	type CreateRivetKitOptions,
	createRivetKit as createVanillaRivetKit,
} from "@rivetkit/framework-base";
import { useStore } from "@tanstack/svelte-store";

export { createClient } from "@rivetkit/actor/client";

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
	function useActor<ActorName extends keyof ExtractActorsFromRegistry<any>>(
		opts: ActorOptions<Registry, ActorName>,
	) {
		const { mount, setState, state } = getOrCreateActor<ActorName>(opts);

		// Create reactive state using Svelte 5 runes
		let actorStoreState = useStore(state) || {};
		// Track cleanup functions
		let storeUnsubscribe: any;

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
			storeUnsubscribe?.();
			mount();
			// Subscribe to state changes
			storeUnsubscribe = state.subscribe((changes) => {
				if (changes) {
					actorStoreState = changes.currentVal as any;
				}
			});

			// Cleanup function
			return () => {
				storeUnsubscribe?.();
			};
		});

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
			let eventUnsubscribe: (() => void) | null = null;

			$effect.root(() => {
				// Clean up previous event listener
				eventUnsubscribe?.();
				if (!actorStoreState.current?.connection) return;

				const connection = actorStoreState.current?.connection;
				// Set up new event listener if connection exists

				eventUnsubscribe = connection.on(eventName, handler);

				// Cleanup function
				return () => {
					eventUnsubscribe?.();
				};
			});
		}
		const actorState = $derived.by(() => actorStoreState.current);
		// Return reactive state and utilities
		return {
			actorState,
			useEvent,
		};
	}

	return {
		useActor,
	};
}
