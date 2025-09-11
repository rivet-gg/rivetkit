import { logger } from "./log";

// Error class for Engine API errors
export class EngineApiError extends Error {
	constructor(
		public readonly group: string,
		public readonly code: string,
		message?: string,
	) {
		super(message || `Engine API error: ${group}/${code}`);
		this.name = "EngineApiError";
	}
}

// Helper function for making API calls
export async function apiCall<TInput = unknown, TOutput = unknown>(
	endpoint: string,
	namespace: string,
	method: "GET" | "POST" | "PUT" | "DELETE",
	path: string,
	body?: TInput,
): Promise<TOutput> {
	const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}namespace=${encodeURIComponent(namespace)}`;

	const options: RequestInit = {
		method,
		headers: {
			"Content-Type": "application/json",
		},
	};

	if (body !== undefined && method !== "GET") {
		options.body = JSON.stringify(body);
	}

	logger().debug("making api call", { method, url });

	const response = await fetch(url, options);

	if (!response.ok) {
		const errorText = await response.text();
		logger().error("api call failed", {
			status: response.status,
			statusText: response.statusText,
			error: errorText,
			method,
			path,
		});

		// Try to parse error response
		try {
			const errorData = JSON.parse(errorText);
			if (errorData.kind === "error" && errorData.group && errorData.code) {
				throw new EngineApiError(
					errorData.group,
					errorData.code,
					errorData.message,
				);
			}
		} catch (parseError) {
			// If parsing fails or it's not our expected error format, continue
		}

		throw new Error(
			`API call failed: ${response.status} ${response.statusText}`,
		);
	}

	return response.json() as Promise<TOutput>;
}
