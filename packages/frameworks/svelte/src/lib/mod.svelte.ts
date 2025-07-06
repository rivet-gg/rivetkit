// Requires Svelte 5 and runes enabled
import { useStore } from "@tanstack/svelte-store";
import {
	type AnyActorRegistry,
	type CreateRivetKitOptions,
	type ActorOptions,
	createRivetKit as createVanillaRivetKit,
} from "@rivetkit/framework-base";
import type { Client, ExtractActorsFromRegistry } from "@rivetkit/core/client";

export { createClient } from "@rivetkit/core/client";

/**
 * Creates a RivetKit instance for Svelte 5 using runes.
 * @param client - The RivetKit client
 * @param opts - Optional configuration
 */
export function createRivetKit<Registry extends AnyActorRegistry>(
	client: Client<Registry>,
	opts: CreateRivetKitOptions<Registry> = {}
) {
	const { getOrCreateActor } = createVanillaRivetKit<
		Registry,
		ExtractActorsFromRegistry<Registry>,
		keyof ExtractActorsFromRegistry<Registry>
	>(client, opts);

	/**
	 * Hook to connect to a actor and retrieve its state. Using this hook with the same options
	 * will return the same actor instance. This simplifies passing around the actor state in your components.
	 * It also provides a method to listen for events emitted by the actor.
	 * @param opts - Options for the actor, including its name, key, and parameters.
	 * @returns An object containing the actor's state and a method to listen for events.
	 */
	function useActor<ActorName extends keyof ExtractActorsFromRegistry<Registry>>(
		opts: ActorOptions<Registry, ActorName>
	) {
		const { mount, setState, state } = getOrCreateActor<ActorName>(opts);
		$effect(() => {
			setState((prev) => {
				prev.opts = {
					...opts,
					enabled: opts.enabled ?? true,
				};

				return prev;
			});
		});

		// Mount the actor and handle cleanup
		$effect.pre(() => {
			return mount();
		});

		// Use TanStack Svelte store to get reactive state
		const actorState = useStore(state) || {};

		/**
		 * Hook to listen for events emitted by the actor.
		 * This hook allows you to subscribe to specific events emitted by the actor and execute a handler function
		 * when the event occurs.
		 * It uses the `$effect` rune to set up the event listener when the actor connection is established.
		 * It cleans up the listener when the component unmounts or when the actor connection changes.
		 * @param eventName The name of the event to listen for.
		 * @param handler The function to call when the event is emitted.
		 */
		const useEvent = (
			eventName: string,
			handler: (...args: any[]) => void
		) => {
			$effect(() => {
				// track dependency so that the effect is re-run when the actor connection changes
				actorState.current?.isConnected;

				if (!actorState.current.connection) return;
				return actorState.current.connection.on(eventName, handler);
			});
		};

		return {
			get hash() {
				return actorState.current.hash;
			},
			get handle() {
				return actorState.current.handle;
			},
			get connection() {
				return actorState.current.connection;
			},
			get isConnected() {
				return actorState.current.isConnected;
			},
			get isConnecting() {
				return actorState.current.isConnecting;
			},
			get isError() {
				return actorState.current.isError;
			},
			get error() {
				return actorState.current.error;
			},
			get opts() {
				return actorState.current.opts;
			},
			useEvent,
		} satisfies typeof actorState.current & {
			useEvent: typeof useEvent;
		}
	}

	return {
		useActor,
	};
}