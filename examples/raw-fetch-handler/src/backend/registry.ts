import { type ActorContextOf, actor, setup } from "@rivetkit/actor";
import { Hono } from "hono";
import { cors } from "hono/cors";

export const counter = actor({
	state: {
		count: 0,
	},
	onAuth: () => {
		return {};
	},
	createVars: () => {
		return { router: createCounterRouter() };
	},
	onFetch: (c, request) => {
		console.log("url", request.url);
		return c.vars.router.fetch(request, { actor: c });
	},
	actions: {},
});

interface RouterEnv {
	actor: ActorContextOf<typeof counter>;
}

function createCounterRouter(): Hono<any> {
	const app = new Hono<{ Bindings: RouterEnv }>();

	app.use("*", (c, next) => {
		console.log("path", c.req.path);
		return next();
	});

	app.get("/count", (c) => {
		const { actor } = c.env;

		return c.json({
			count: actor.state.count,
		});
	});

	app.post("/increment", (c) => {
		const { actor } = c.env;

		actor.state.count++;
		return c.json({
			count: actor.state.count,
		});
	});

	return app;
}

export const registry = setup({
	use: { counter },
});
