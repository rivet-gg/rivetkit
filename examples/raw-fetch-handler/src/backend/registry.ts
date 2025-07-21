import { type ActorContextOf, actor, setup } from "@rivetkit/actor";
import { Hono } from "hono";

export const counter = actor({
	state: {
		count: 0,
	},
	onAuth: () => {
		// Skip auth, make onFetch public
		return {};
	},
	createVars: () => {
		// Setup router
		return { router: createCounterRouter() };
	},
	onFetch: (c, request) => {
		return c.vars.router.fetch(request, { actor: c });
	},
	actions: {
		// ...actions...
	},
});

function createCounterRouter(): Hono<any> {
	const app = new Hono<{
		Bindings: { actor: ActorContextOf<typeof counter> };
	}>();

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
