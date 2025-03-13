import { logger } from "@/client/log";

export async function importEventSource(): Promise<typeof EventSource> {
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
}
