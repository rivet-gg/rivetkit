import type { AnyActorInstance } from "./instance";
import type { ActorDriver } from "./driver";
import { KEYS } from "./keys";
import { logger } from "./log";
import { stringifyError } from "@/common/utils";

interface ScheduleState {
	// Sorted by timestamp asc
	events: ScheduleIndexEvent[];
}

interface ScheduleIndexEvent {
	timestamp: number;
	eventId: string;
}

interface ScheduleEvent {
	timestamp: number;
	fn: string;
	args: unknown[];
}

export class Schedule {
	#actor: AnyActorInstance;
	#driver: ActorDriver;

	constructor(actor: AnyActorInstance, driver: ActorDriver) {
		this.#actor = actor;
		this.#driver = driver;
	}

	async after(duration: number, fn: string, ...args: unknown[]) {
		await this.#scheduleEvent(Date.now() + duration, fn, args);
	}

	async at(timestamp: number, fn: string, ...args: unknown[]) {
		await this.#scheduleEvent(timestamp, fn, args);
	}

	async #scheduleEvent(
		timestamp: number,
		fn: string,
		args: unknown[],
	): Promise<void> {
		// Save event
		const eventId = crypto.randomUUID();
		await this.#driver.kvPut(
			this.#actor.id,
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			KEYS.SCHEDULE.event(eventId) as any,
			{
				timestamp,
				fn,
				args,
			},
		);

		// TODO: Clean this up to use list instead of get
		// Read index
		const schedule: ScheduleState = ((await this.#driver.kvGet(
			this.#actor.id,
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			KEYS.SCHEDULE.SCHEDULE as any,
		)) as ScheduleState) ?? {
			events: [],
		};

		// Insert event in to index
		const newEvent: ScheduleIndexEvent = { timestamp, eventId };
		const insertIndex = schedule.events.findIndex(
			(x) => x.timestamp > newEvent.timestamp,
		);
		if (insertIndex === -1) {
			schedule.events.push(newEvent);
		} else {
			schedule.events.splice(insertIndex, 0, newEvent);
		}

		// Write new index
		await this.#driver.kvPut(this.#actor.id, KEYS.SCHEDULE.SCHEDULE, schedule);

		// Update alarm if:
		// - this is the newest event (i.e. at beginning of array) or
		// - this is the only event (i.e. the only event in the array)
		if (insertIndex === 0 || schedule.events.length === 1) {
			await this.#driver.setAlarm(this.#actor, newEvent.timestamp);
		}
	}

	async __onAlarm() {
		const now = Date.now();

		// Read index
		const scheduleIndex: ScheduleState = ((await this.#driver.kvGet(
			this.#actor.id,
			KEYS.SCHEDULE.SCHEDULE,
		)) as ScheduleState | undefined) ?? { events: [] };

		// Remove events from schedule
		const runIndex = scheduleIndex.events.findIndex((x) => x.timestamp < now);
		const scheduleIndexEvents = scheduleIndex.events.splice(0, runIndex + 1);

		// Find events to trigger
		const eventKeys = scheduleIndexEvents.map((x) =>
			KEYS.SCHEDULE.event(x.eventId),
		);
		const scheduleEvents = (await this.#driver.kvGetBatch(
			this.#actor.id,
			eventKeys,
		)) as ScheduleEvent[];
		await this.#driver.kvDeleteBatch(this.#actor.id, eventKeys);

		// Write new schedule
		await this.#driver.kvPut(
			this.#actor.id,
			KEYS.SCHEDULE.SCHEDULE,
			scheduleIndex,
		);

		// Set alarm for next event
		if (scheduleIndex.events.length > 0) {
			await this.#driver.setAlarm(
				this.#actor,
				scheduleIndex.events[0].timestamp,
			);
		}

		// Iterate by event key in order to ensure we call the events in order
		for (const event of scheduleEvents) {
			try {
				// Look up function
				const fn: unknown = this.#actor[event.fn as keyof AnyActorInstance];
				if (!fn) throw new Error(`Missing function for alarm ${event.fn}`);
				if (typeof fn !== "function")
					throw new Error(
						`Alarm function lookup for ${event.fn} returned ${typeof fn}`,
					);

				// Call function
				try {
					await fn.apply(this.#actor, event.args);
				} catch (error) {
					await this.#driver.kvPut(
						this.#actor.id,
						KEYS.SCHEDULE.alarmError(event.fn),
						{
							error: error,
							timestamp: now,
						},
					);
				}
			} catch (err) {
				logger().error("failed to run scheduled event", {
					fn: event.fn,
					error: stringifyError(err),
				});

				// Write internal error
				await this.#driver.kvPut(
					this.#actor.id,
					KEYS.SCHEDULE.alarmError(event.fn),
					{
						error: stringifyError(err),
						timestamp: now,
					},
				);
			}
		}
	}
}
