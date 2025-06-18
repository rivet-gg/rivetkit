import { httpUserAgent } from "rivetkit/utils";

export interface RivetClientConfig {
	endpoint: string;
	token: string;
	project?: string;
	environment?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: will add api types later
export type RivetActor = any;
// biome-ignore lint/suspicious/noExplicitAny: will add api types later
export type RivetBuild = any;

export async function rivetRequest<RequestBody, ResponseBody>(
	config: RivetClientConfig,
	method: string,
	url: string,
	body?: RequestBody,
): Promise<ResponseBody> {
	const urlBuilder = new URL(url, config.endpoint);
	if (config.project) {
		urlBuilder.searchParams.append("project", config.project);
	}
	if (config.environment) {
		urlBuilder.searchParams.append("environment", config.environment);
	}

	const response = await fetch(urlBuilder, {
		method,
		headers: {
			"Content-Type": "application/json",
			"User-Agent": httpUserAgent(),
			Authorization: `Bearer ${config.token}`,
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		const errorData: any = await response.json().catch(() => ({}));
		throw new Error(
			`Rivet API error (${response.status}, ${method} ${url}): ${errorData.message || response.statusText}`,
		);
	}

	return (await response.json()) as ResponseBody;
}
