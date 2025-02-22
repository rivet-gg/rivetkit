import { z, type ZodTypeAny } from "zod";

export async function getServiceToken(
	api: ReturnType<typeof createRivetApi>,
	{ project, env }: { project: string; env: string },
): Promise<string> {
	const games = await api.get(
		"/cloud/games",
		z.object({
			games: z.array(z.object({ name_id: z.string(), game_id: z.string() })),
		}),
	);

	const game = games.games.find((game) => game.name_id === project);

	if (!game) {
		throw new Error(`Game ${project} not found`);
	}

	const gameFull = await api.get(
		`/cloud/games/${game.game_id}`,
		z.object({
			game: z.object({
				namespaces: z.array(
					z.object({ namespace_id: z.string(), name_id: z.string() }),
				),
			}),
		}),
	);

	const namespace = gameFull.game.namespaces.find(
		(namespace) => namespace.name_id === env,
	);

	if (!namespace) {
		throw new Error(`Namespace ${env} not found`);
	}

	const serviceToken = await api.post(
		`/games/${game.game_id}/environments/${namespace.namespace_id}/tokens/service`,
		z.object({
			token: z.string(),
		}),
	);

	return serviceToken.token;
}

export function createRivetApi(endpoint: string, accessToken: string) {
	const call = async <T extends ZodTypeAny>(
		opts: RequestInit,
		path:
			| string
			| {
					// biome-ignore lint/suspicious/noExplicitAny: any value allowed here
					search: Record<string, any>;
					pathname: string;
			  },
		schema: T,
	): Promise<z.infer<T>> => {
		const url = new URL(endpoint);

		if (typeof path === "object") {
			// remove the trailing slash from the endpoint
			url.pathname = `${url.pathname.replace(/\/$/, "")}${path.pathname}`;
			for (const [key, value] of Object.entries(path.search)) {
				url.searchParams.append(key, value);
			}
		} else {
			url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
		}

		const response = await fetch(url, {
			...opts,
			headers: {
				...opts.headers,
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(error);
		}

		return schema.parse(await response.json());
	};

	call.get = <T extends ZodTypeAny>(
		path:
			| string
			| {
					// biome-ignore lint/suspicious/noExplicitAny: any value allowed here
					search: Record<string, any>;
					pathname: string;
			  },
		schema: T,
	) => call({ method: "GET" }, path, schema);
	call.post = <T extends ZodTypeAny>(
		path:
			| string
			| {
					// biome-ignore lint/suspicious/noExplicitAny: any value allowed here
					search: Record<string, any>;
					pathname: string;
			  },
		schema: T,
	) => call({ method: "POST" }, path, schema);
	return call;
}

export const createActorEndpoint = (network: {
	// biome-ignore lint/suspicious/noExplicitAny: any is used here to match the type of network.ports
	ports: Record<string, any>;
}) => {
	try {
		const http = Object.values(network.ports).find(
			(port) => port.protocol === "http" || port.protocol === "https",
		);

		if (!http) {
			return undefined;
		}

		if (http.url) {
			return http.url;
		}
		const url = new URL(`${http.protocol}://${http.hostname}:${http.port}`);
		url.pathname = http.path || "/";
		return url.href;
	} catch (e) {
		console.log(e);
		return undefined;
	}
};
