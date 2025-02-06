export async function importEventSource(): Promise<typeof EventSource> {
	let _EventSource: typeof EventSource;

	// Node.js environment
	try {
		const es = await import("eventsource");
		_EventSource = es.EventSource;
	} catch (err) {
		if (typeof EventSource !== "undefined") {
			// Browser environment
			_EventSource = EventSource;
		} else {
			// EventSource not available
			_EventSource = class MockEventSource {
				constructor() {
					throw new Error(
						'EventSource support requires installing the "eventsource" package',
					);
				}
			} as unknown as typeof EventSource;
		}
	}

	return _EventSource;
}
