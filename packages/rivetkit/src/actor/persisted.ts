import type { ConnectionDriver } from "./connection";

/** State object that gets automatically persisted to storage. */
export interface PersistedActor<S, CP, CS, I> {
	input?: I;
	hasInitiated: boolean;
	state: S;
	connections: PersistedConn<CP, CS>[];
	scheduledEvents: PersistedScheduleEvent[];
}

/** Object representing connection that gets persisted to storage. */
export interface PersistedConn<CP, CS> {
	connId: string;
	token: string;
	connDriver: ConnectionDriver;
	connDriverState: unknown;
	params: CP;
	state: CS;
	authData?: unknown;
	subscriptions: PersistedSubscription[];
	lastSeen: number;
}

export interface PersistedSubscription {
	eventName: string;
}

export interface GenericPersistedScheduleEvent {
	actionName: string;
	args: ArrayBuffer | null;
}

export type PersistedScheduleEventKind = {
	generic: GenericPersistedScheduleEvent;
};

export interface PersistedScheduleEvent {
	eventId: string;
	timestamp: number;
	kind: PersistedScheduleEventKind;
}
