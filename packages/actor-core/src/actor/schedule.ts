import type { AnyActorInstance } from "./instance";

export interface ScheduledEvent {
  id: string;
  createdAt: number;
  triggersAt: number;
  fn: string;
  args: unknown[];
}

export class Schedule {
	#actor: AnyActorInstance;

	constructor(actor: AnyActorInstance) {
		this.#actor = actor;
	}

	async after(duration: number, fn: string, ...args: unknown[]): Promise<string> {
		return await this.#actor.scheduleEvent(Date.now() + duration, fn, args);
	}

	async at(timestamp: number, fn: string, ...args: unknown[]) {
		return await this.#actor.scheduleEvent(timestamp, fn, args);
	}

	async get(alarmId: string) {
    return this.#actor.getEvent(alarmId);
	}

	async cancel(eventId: string) {
		await this.#actor.cancelEvent(eventId);
	}

	async list() {
		return await this.#actor.listEvents();
	}
}
