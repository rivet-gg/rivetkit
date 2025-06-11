import { useStore } from "@tanstack/react-store";
import {
	type AnyWorkerRegistry,
	type CreateRivetKitOptions,
	type WorkerOptions,
	createRivetKit as createVanillaRivetKit,
} from "@rivetkit/framework-base";
import type { Client, ExtractWorkersFromApp } from "rivetkit/client";
import { useEffect } from "react";

export { createClient } from "rivetkit/client";

export function createRivetKit<Registry extends AnyWorkerRegistry>(
	client: Client<Registry>,
	opts: CreateRivetKitOptions<Registry> = {},
) {
	const { getOrCreateWorker } = createVanillaRivetKit<
		Registry,
		ExtractWorkersFromApp<Registry>,
		keyof ExtractWorkersFromApp<Registry>
	>(client, opts);

	/**
	 * Hook to connect to a worker and retrieve its state. Using this hook with the same options
	 * will return the same worker instance. This simplifies passing around the worker state in your components.
	 * It also provides a method to listen for events emitted by the worker.
	 * @param opts - Options for the worker, including its name, key, and parameters.
	 * @returns An object containing the worker's state and a method to listen for events.
	 */
	function useWorker<WorkerName extends keyof ExtractWorkersFromApp<Registry>>(
		opts: WorkerOptions<Registry, WorkerName>,
	) {
		const { mount, setState, state } = getOrCreateWorker<WorkerName>(opts);

		useEffect(() => {
			setState((prev) => {
				prev.opts = {
					...prev.opts,
					...opts,
					params: {
						...prev.opts.params,
						...opts.params,
					},
					enabled: opts.enabled ?? true,
				};
				return prev;
			});
		}, [opts, setState]);

		useEffect(() => {
			return mount();
		}, [mount]);

		const workerState = useStore(state) || {};

		/**
		 * Hook to listen for events emitted by the worker.
		 * This hook allows you to subscribe to specific events emitted by the worker and execute a handler function
		 * when the event occurs.
		 * It uses the `useEffect` hook to set up the event listener when the worker connection is established.
		 * It cleans up the listener when the component unmounts or when the worker connection changes.
		 * @param eventName The name of the event to listen for.
		 * @param handler The function to call when the event is emitted.
		 */
		const useEvent = (eventName: string, handler: (data: any) => void) => {
			useEffect(() => {
				if (!workerState?.connection) return;

				const connection = workerState.connection;
				return connection.on(eventName, handler);
			}, [workerState.connection, eventName, handler]);
		};
		return {
			...workerState,
			useEvent,
		};
	}

	return {
		useWorker,
	};
}
