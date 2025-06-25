/** State object that gets automatically persisted to storage. */
export interface PersistedActor<S, CP, CS> {
	// State
	s: S;
	// Connections
	c: PersistedConn<CP, CS>[];
	// Scheduled events
	e: PersistedScheduleEvents[];
}

/** Object representing connection that gets persisted to storage. */
export interface PersistedConn<CP, CS> {
	// ID
	i: string;
	// Token
	t: string;
	// Connection driver
	d: string;
	// Connection driver state
	ds: unknown;
	// Parameters
	p: CP;
	// State
	s: CS;
	// Auth data
	a?: unknown;
	// Subscriptions
	su: PersistedSubscription[];
}

export interface PersistedSubscription {
	// Event name
	n: string;
}

export interface PersistedScheduleEvents {
	// Event ID
	e: string;
	// Timestamp
	t: number;
	// Action name
	a: string;
	// Arguments
	ar: unknown[];
}
