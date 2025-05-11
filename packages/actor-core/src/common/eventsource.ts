import { logger } from "@/client/log";

// Global singleton promise that will be reused for subsequent calls
let eventSourcePromise: Promise<typeof EventSource> | null = null;

export async function importEventSource(): Promise<typeof EventSource> {
	// Return existing promise if we already started loading
	if (eventSourcePromise !== null) {
		return eventSourcePromise;
	}

	// Create and store the promise
	eventSourcePromise = (async () => {
		let _EventSource: typeof EventSource;

		if (typeof EventSource !== "undefined") {
			// Browser environment
			_EventSource = EventSource;
			logger().debug("using native eventsource");
		} else {
			// Node.js environment
			try {
				const es = await import("eventsource");
				_EventSource = es.EventSource;
				logger().debug("using eventsource from npm");
			} catch (err) {
				// EventSource not available
				_EventSource = class MockEventSource {
					constructor() {
						throw new Error(
							'EventSource support requires installing the "eventsource" peer dependency.',
						);
					}
				} as unknown as typeof EventSource;
				logger().debug("using mock eventsource");
			}
		}

		return _EventSource;
	})();

	return eventSourcePromise;
}
