import type { ConnectionDriver } from "./connection";
import type { ScheduledLivenessCheckEvent } from "./schedule";

/** State object that gets automatically persisted to storage. */
export interface PersistedActor<S, CP, CS, I> {
	// Input
	i?: I;
	// Has initialized
	hi: boolean;
	// State
	s: S;
	// Connections
	c: PersistedConn<CP, CS>[];
	// Scheduled events
	e: PersistedScheduleEvent[];
}

/** Object representing connection that gets persisted to storage. */
export interface PersistedConn<CP, CS> {
	// ID
	i: string;
	// Token
	t: string;
	// Connection driver
	d: ConnectionDriver;
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
	// Last seen
	l: number;
}

export interface PersistedSubscription {
	// Event name
	n: string;
}

export interface GenericPersistedScheduleEvent {
	// Event ID
	e: string;
	// Timestamp
	t: number;
	// Action name
	a: string;
	// Arguments
	ar?: unknown[];
}

export interface ScheduleLivenessCheckEvent {
	ccl: ScheduledLivenessCheckEvent["checkConnectionLiveness"];
	// Timestamp
	t: number;
}

export type PersistedScheduleEvent =
	| GenericPersistedScheduleEvent
	| ScheduleLivenessCheckEvent;
