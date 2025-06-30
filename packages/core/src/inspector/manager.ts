import { Hono } from "hono";
import invariant from "invariant";
import type { Actor } from "./protocol/common";

export type ManagerInspectorRouterEnv = {
	Variables: {
		inspector: ManagerInspector;
	};
};

/**
 * Create a router for the Manager Inspector.
 * @internal
 */
export function createManagerInspectorRouter() {
	return new Hono<ManagerInspectorRouterEnv>()
		.get("/ping", (c) => {
			return c.json({ message: "pong" }, 200);
		})
		.get("/actors", async (c) => {
			const limit = Number.parseInt(c.req.query("limit") ?? "") || undefined;
			const cursor = c.req.query("cursor") || undefined;

			invariant(limit && limit > 0, "Limit must be a positive integer");

			const actors = await c.var.inspector.accessors.getAllActors({
				limit,
				cursor,
			});
			return c.json(actors, 200);
		})
		.get("/actor/:id", async (c) => {
			const id = c.req.param("id");
			const actor = await c.var.inspector.accessors.getActorById(id);
			if (!actor) {
				return c.json({ error: "Actor not found" }, 404);
			}
			return c.json(actor, 200);
		})
		.get("/bootstrap", async (c) => {
			const actors = await c.var.inspector.accessors.getAllActors({
				limit: 10,
			});
			return c.json({ actors }, 200);
		});
}

interface ManagerInspectorAccessors {
	getAllActors: (param: { cursor?: string; limit: number }) => Promise<Actor[]>;
	getActorById: (id: string) => Promise<Actor | null>;
}

/**
 * Provides a unified interface for inspecting actor external and internal state.
 */
export class ManagerInspector {
	public readonly accessors: ManagerInspectorAccessors;

	constructor(accessors: () => ManagerInspectorAccessors) {
		this.accessors = accessors();
	}
}
