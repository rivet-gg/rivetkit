import { TZDate } from "@date-fns/tz";
import { UserError, actor, setup } from "actor-core";
import { addDays, set } from "date-fns";
import { Resend } from "resend";

const user = actor({
	state: {
		email: null as string | null,
		timeZone: "UTC",
		streakCount: 0,
		lastCompletedAt: 0,
	},

	createVars: () => ({
		resend: new Resend(process.env.RESEND_API_KEY),
	}),

	actions: {
		completeSignUp: async (c, email: string, timeZone: string) => {
			if (c.state.email) throw new UserError("Already signed up");

			c.state.email = email;
			c.state.timeZone = timeZone;

			// Schedule daily streak check
			const tomorrow = set(addDays(TZDate.tz(timeZone), 1), {
				hours: 17,
				minutes: 0,
				seconds: 0,
				milliseconds: 0,
			});
			await c.schedule.at(tomorrow.getTime(), "dailyStreakReminder");
			return { success: true };
		},

		completeDailyChallenge: async (c) => {
			if (!c.state.email) throw new UserError("Not signed up");

			const today = TZDate.tz(c.state.timeZone);
			const yesterday = addDays(today, -1);
			const lastCompletedDate = TZDate.tz(
				c.state.timeZone,
				c.state.lastCompletedAt,
			);

			// Check if already completed
			if (isSameDay(today, lastCompletedDate)) {
				throw new UserError("Already completed streak today");
			}

			// Update streak
			const isConsecutiveDay = isSameDay(lastCompletedDate, yesterday);
			c.state.streakCount = isConsecutiveDay ? c.state.streakCount + 1 : 1;
			c.state.lastCompletedAt = Date.now();

			// Send congratulatory email
			await c.vars.resend.emails.send({
				from: "streaks@example.com",
				to: c.state.email,
				subject: `Congratulations on Your ${c.state.streakCount}-Day Streak!`,
				html: `<p>Congratulations on completing your ${c.state.streakCount}-day streak!</p>`,
			});

			return { streakCount: c.state.streakCount };
		},

		dailyStreakReminder: async (c) => {
			if (!c.state.email) throw new UserError("Not signed up");
			if (!c.state.timeZone) throw new UserError("Time zone not set");

			const today = TZDate.tz(c.state.timeZone);
			const lastCompletedDate = TZDate.tz(
				c.state.timeZone,
				c.state.lastCompletedAt,
			);

			// Don't send reminder if already completed today
			if (!isSameDay(lastCompletedDate, today)) {
				await c.vars.resend.emails.send({
					from: "streaks@example.com",
					to: c.state.email,
					subject: "Don't Break Your Streak!",
					html: `<p>Don't forget to complete today's challenge to maintain your ${c.state.streakCount}-day streak!</p>`,
				});
			}

			// Schedule the next check for tomorrow at 5 PM
			const tomorrow = set(addDays(today, 1), {
				hours: 17,
				minutes: 0,
				seconds: 0,
				milliseconds: 0,
			});
			await c.schedule.at(tomorrow.getTime(), "dailyStreakReminder");
		},
	},
});

function isSameDay(a: TZDate, b: TZDate) {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export const app = setup({
	actors: { user },
});

export type App = typeof app;
