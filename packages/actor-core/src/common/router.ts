import type { Context as HonoContext, Next } from "hono";
import { getLogger, Logger } from "./log";
import { deconstructError } from "./utils";
import { getRequestEncoding } from "@/actor/router-endpoints";
import { serialize } from "@/actor/protocol/serde";
import { ResponseError } from "@/actor/protocol/http/error";

export function logger() {
	return getLogger("router");
}

export function loggerMiddleware(logger: Logger) {
	return async (c: HonoContext, next: Next) => {
		const method = c.req.method;
		const path = c.req.path;
		const startTime = Date.now();

		await next();

		const duration = Date.now() - startTime;
		logger.info("http request", {
			method,
			path,
			status: c.res.status,
			dt: `${duration}ms`,
			reqSize: c.req.header("content-length"),
			resSize: c.res.headers.get("content-length"),
			userAgent: c.req.header("user-agent"),
		});
	};
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

	const encoding = getRequestEncoding(c.req);
	const output = serialize(
		{
			c: code,
			m: message,
			md: metadata,
		} satisfies ResponseError,
		encoding,
	);

	return c.body(output, { status: statusCode });
}
