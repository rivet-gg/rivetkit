import type { Context as HonoContext } from "hono";
import { getLogger } from "./log";
import { deconstructError } from "./utils";

export function logger() {
	return getLogger("router");
}

export function handleRouteNotFound(c: HonoContext) {
	return c.text("Not Found (ActorCore)", 404);
}

export function handleRouteError(error: unknown, c: HonoContext) {
	const { statusCode, code, message, metadata } = deconstructError(
		error,
		logger(),
		{
			method: c.req.method,
			path: c.req.path,
		},
	);

	return c.json({ code, message, metadata }, { status: statusCode });
}
