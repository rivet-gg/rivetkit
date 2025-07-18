import { createClient } from "@rivetkit/actor/client";
import { createReactRivetKit } from "@rivetkit/react";
import { useState } from "react";
import type { Registry } from "../actors/registry";

const client = createClient<Registry>("http://localhost:8080");
const { useActor } = createReactRivetKit(client);

export function RateLimiter() {
	// Connect to API rate limiter for user-123
	const [{ actor }] = useActor("rateLimiter", { tags: { userId: "user-123" } });
	const [result, setResult] = useState<{
		allowed: boolean;
		remaining: number;
		resetsIn: number;
	} | null>(null);

	// Make a request
	const makeRequest = async () => {
		if (!actor) return;

		const response = await actor.checkLimit();
		setResult(response);
	};

	return (
		<div>
			<h2>Rate Limiter (5 req/min)</h2>

			<button onClick={makeRequest}>Make Request</button>

			{result && (
				<div>
					<p>Status: {result.allowed ? "Allowed" : "Blocked"}</p>
					<p>Remaining: {result.remaining}</p>
					<p>Resets in: {result.resetsIn} seconds</p>
				</div>
			)}
		</div>
	);
}
