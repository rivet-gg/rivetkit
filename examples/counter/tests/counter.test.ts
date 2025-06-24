import { test, expect } from "vitest";
import { setupTest } from "@rivetkit/worker/test";
import { registry } from "../src/workers/registry";

test("it should count", async (test) => {
	const { client } = await setupTest(test, registry);
	const counter = client.counter.getOrCreate().connect();

	// Test initial count
	expect(await counter.getCount()).toBe(0);

	// Test event emission
	let eventCount = -1;
	counter.on("newCount", (count: number) => {
		eventCount = count;
	});

	// Test increment
	const incrementAmount = 5;
	const result = await counter.increment(incrementAmount);
	expect(result).toBe(incrementAmount);

	// Verify event was emitted with correct count
	expect(eventCount).toBe(incrementAmount);

	// Test multiple increments
	for (let i = 1; i <= 3; i++) {
		const newCount = await counter.increment(incrementAmount);
		expect(newCount).toBe(incrementAmount * (i + 1));
		expect(eventCount).toBe(incrementAmount * (i + 1));
	}

	// Verify final count
	expect(await counter.getCount()).toBe(incrementAmount * 4);
});
