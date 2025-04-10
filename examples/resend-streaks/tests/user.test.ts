import { test, expect, vi, beforeEach } from "vitest";
import { setupTest } from "actor-core/test";
import { app } from "../actors/app";

// Create mock for send method
const mockSendEmail = vi.fn().mockResolvedValue({ success: true });

// Set up the spy once before all tests
beforeEach(() => {
	process.env.RESEND_API_KEY = "test_mock_api_key_12345";

	vi.mock("resend", () => {
		return {
			Resend: vi.fn().mockImplementation(() => {
				return {
					emails: {
						send: mockSendEmail
					}
				};
			})
		};
	});

	mockSendEmail.mockClear();
});

test("streak tracking with time zone signups", async (t) => {
	const { client } = await setupTest(t, app);
	const actor = await client.user.get();

	// Sign up with specific time zone
	const signupResult = await actor.completeSignUp(
		"user@example.com",
		"America/New_York",
	);
	expect(signupResult.success).toBe(true);

	// Complete the challenge
	const challengeResult = await actor.completeDailyChallenge();
	expect(challengeResult.streakCount).toBe(1);

	// Verify streak 1 email was sent
	expect(mockSendEmail).toHaveBeenCalledWith(
		expect.objectContaining({
			to: "user@example.com",
			subject: "Congratulations on Your 1-Day Streak!",
		}),
	);

	// Try to complete it again within 24 hours (should throw an error)
	try {
		await actor.completeDailyChallenge();
		// If we don't throw, test should fail
		expect(true).toBe(false);
	} catch (error: any) {
		expect(error.message).toContain("Already completed");
	}

	// Fast forward time to the next day
	await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

	// Complete challenge again, check streak is +1
	const nextDayResult = await actor.completeDailyChallenge();
	expect(nextDayResult.streakCount).toBe(2);

	// Verify streak 2 email was sent
	expect(mockSendEmail).toHaveBeenCalledWith(
		expect.objectContaining({
			to: "user@example.com",
			subject: "Congratulations on Your 2-Day Streak!",
		}),
	);

	// Fast forward time to the next day again
	await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

	// Complete challenge again, check streak is now 3
	const thirdDayResult = await actor.completeDailyChallenge();
	expect(thirdDayResult.streakCount).toBe(3);

	// Verify streak 3 email was sent
	expect(mockSendEmail).toHaveBeenCalledWith(
		expect.objectContaining({
			to: "user@example.com",
			subject: "Congratulations on Your 3-Day Streak!",
		}),
	);

	// Fast forward 2 days then check again to make sure streak breaks
	await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);

	// Streak should reset to 1 after missing days
	const afterBreakResult = await actor.completeDailyChallenge();
	expect(afterBreakResult.streakCount).toBe(1);

	// Verify streak reset email was sent
	expect(mockSendEmail).toHaveBeenCalledWith(
		expect.objectContaining({
			to: "user@example.com",
			subject: "Congratulations on Your 1-Day Streak!",
		}),
	);
});
