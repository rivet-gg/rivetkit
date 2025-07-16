// import { getEnvUniversal, httpUserAgent } from "@/utils";
//
// export interface RivetClientConfig {
// 	endpoint: string;
// 	token: string;
// 	project?: string;
// 	environment?: string;
// }
//
// export function getRivetClientConfig(): RivetClientConfig {
// 	const endpoint = getEnvUniversal("RIVET_ENDPOINT");
// 	if (!endpoint) throw new Error("missing RIVET_ENDPOINT");
// 	const token = getEnvUniversal("RIVET_SERVICE_TOKEN");
// 	if (!token) throw new Error("missing RIVET_SERVICE_TOKEN");
// 	const project = getEnvUniversal("RIVET_PROJECT");
// 	if (!project) throw new Error("missing RIVET_PROJECT");
// 	const environment = getEnvUniversal("RIVET_ENVIRONMENT");
// 	if (!environment) throw new Error("missing RIVET_ENVIRONMENT");
//
// 	return {
// 		endpoint,
// 		token,
// 		project,
// 		environment,
// 	};
// }
//
// // biome-ignore lint/suspicious/noExplicitAny: will add api types later
// export type RivetActor = any;
// // biome-ignore lint/suspicious/noExplicitAny: will add api types later
// export type RivetBuild = any;
//
// export async function rivetRequest<RequestBody, ResponseBody>(
// 	config: RivetClientConfig,
// 	method: string,
// 	url: string,
// 	body?: RequestBody,
// ): Promise<ResponseBody> {
// 	const urlBuilder = new URL(url, config.endpoint);
// 	if (config.project) {
// 		urlBuilder.searchParams.append("project", config.project);
// 	}
// 	if (config.environment) {
// 		urlBuilder.searchParams.append("environment", config.environment);
// 	}
//
// 	const response = await fetch(urlBuilder, {
// 		method,
// 		headers: {
// 			"Content-Type": "application/json",
// 			"User-Agent": httpUserAgent(),
// 			Authorization: `Bearer ${config.token}`,
// 		},
// 		body: body ? JSON.stringify(body) : undefined,
// 	});
//
// 	if (!response.ok) {
// 		const errorData: any = await response.json().catch(() => ({}));
// 		throw new Error(
// 			`Rivet API error (${response.status}, ${method} ${url}): ${errorData.message || response.statusText}`,
// 		);
// 	}
//
// 	return (await response.json()) as ResponseBody;
// }
