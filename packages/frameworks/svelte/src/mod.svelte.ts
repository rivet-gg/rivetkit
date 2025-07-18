import {
	type AnyActorRegistry,
	type CreateRivetKitOptions,
	type ActorOptions,
	createRivetKit as createVanillaRivetKit,
} from "@rivetkit/framework-base"
import type { Client, ExtractActorsFromRegistry } from "@rivetkit/core/client"
import { onMount, onDestroy } from "svelte"

export { createClient } from "@rivetkit/core/client"

export function createRivetKit<Registry extends AnyActorRegistry>(
	client: Client<Registry>,
	opts: CreateRivetKitOptions<Registry> = {},
) {
	const { getOrCreateActor } = createVanillaRivetKit<
		Registry,
		ExtractActorsFromRegistry<Registry>,
		keyof ExtractActorsFromRegistry<Registry>
	>(client, opts)

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
		const { mount, setState, state } = getOrCreateActor<ActorName>(opts)

		// Create reactive state using Svelte 5 runes
		let actorState = $state<any>({})
		let isConnected = $state(false)
		let isConnecting = $state(false)
		let isError = $state(false)
		let error = $state<Error | null>(null)
		let connection = $state<any>(null)
		let handle = $state<any>(null)

		// Track cleanup functions
		let unsubscribe: (() => void) | null = null
		let storeUnsubscribe: (() => void) | null = null

		// Update options reactively
		$effect.root(() => {
			setState((prev: any) => {
				prev.opts = {
					...opts,
					enabled: opts.enabled ?? true,
				}
				return prev
			})
		})

		// Mount and subscribe to state changes
		$effect.root(() => {
			// Clean up previous subscription
			if (unsubscribe) {
				unsubscribe()
			}
			if (storeUnsubscribe) {
				storeUnsubscribe()
			}

			// Mount the actor
			unsubscribe = mount()

			// Subscribe to state changes
			storeUnsubscribe = state.subscribe((newState: any) => {
				if (newState) {
					actorState = newState
					isConnected = newState.isConnected ?? false
					isConnecting = newState.isConnecting ?? false
					isError = newState.isError ?? false
					error = newState.error ?? null
					connection = newState.connection ?? null
					handle = newState.handle ?? null
				}
			})

			// Cleanup function
			return () => {
				if (unsubscribe) {
					unsubscribe()
					unsubscribe = null
				}
				if (storeUnsubscribe) {
					storeUnsubscribe()
					storeUnsubscribe = null
				}
			}
		})

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
			let eventUnsubscribe: (() => void) | null = null

			$effect.root(() => {
				// Clean up previous event listener
				if (eventUnsubscribe) {
					eventUnsubscribe()
					eventUnsubscribe = null
				}

				// Set up new event listener if connection exists
				if (connection && isConnected) {
					eventUnsubscribe = connection.on(eventName, handler)
				}

				// Cleanup function
				return () => {
					if (eventUnsubscribe) {
						eventUnsubscribe()
						eventUnsubscribe = null
					}
				}
			})
		}

		// Return reactive state and utilities
		return {
			// Reactive state properties
			get isConnected() { return isConnected },
			get isConnecting() { return isConnecting },
			get isError() { return isError },
			get error() { return error },
			get connection() { return connection },
			get handle() { return handle },
			get state() { return actorState },

			// Event listener function
			useEvent,
		}
	}

	return {
		useActor,
	}
}
