import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createNanoEvents, type Unsubscribe } from "nanoevents";
import { PatchSchema } from "./protocol/common";
import jsonPatch from "fast-json-patch";
import { sValidator } from "@hono/standard-validator";

export type ActorInspectorRouterEnv = {
  Variables: {
    inspector: ActorInspector;
  };
};

/**
 * Create a router for the Actor Inspector.
 * @internal
 */
export function createActorInspectorRouter() {
  return new Hono<ActorInspectorRouterEnv>()
    .get("/ping", (c) => {
      return c.json({ message: "pong" }, 200);
    })
    .get("/state", async (c) => {
      if (await c.var.inspector.accessors.isStateEnabled()) {
        return c.json(
          { enabled: true, state: await c.var.inspector.accessors.getState() },
          200,
        );
      }
      return c.json({ enabled: false, state: null }, 200);
    })
    .patch("/state", sValidator("json", PatchSchema), async (c) => {
      if (!(await c.var.inspector.accessors.isStateEnabled())) {
        return c.json({ enabled: false }, 200);
      }

      const patch = c.req.valid("json");
      const state = await c.var.inspector.accessors.getState();

      const { newDocument: newState } = jsonPatch.applyPatch(state, patch);
      await c.var.inspector.accessors.setState(newState);

      return c.json(
        { enabled: true, state: await c.var.inspector.accessors.getState() },
        200,
      );
    })
    .get("/state/stream", async (c) => {
      if (!(await c.var.inspector.accessors.isStateEnabled())) {
        return c.json({ enabled: false }, 200);
      }

      let id = 0;
      let listener: Unsubscribe;
      return streamSSE(
        c,
        async (stream) => {
          listener = c.var.inspector.emitter.on("stateUpdated", (state) => {
            stream.writeSSE({
              data: JSON.stringify(state),
              event: "state-update",
              id: String(id++),
            });
          });
        },
        async () => {
          listener?.();
        },
      );
    })
    .get("/connections", async (c) => {
      const connections = await c.var.inspector.accessors.getConnections();
      return c.json({ enabled: true, connections }, 200);
    });
}

interface ActorInspectorAccessors {
  isStateEnabled: () => Promise<boolean>;
  getState: () => Promise<unknown>;
  setState: (state: unknown) => Promise<void>;
  getRpcs: () => Promise<string[]>;
  getConnections: () => Promise<unknown>;
}

interface ActorInspectorEmitterEvents {
  stateUpdated: (state: unknown) => void;
}

/**
 * Provides a unified interface for inspecting actor external and internal state.
 */
export class ActorInspector {
  public readonly accessors: ActorInspectorAccessors;
  public readonly emitter = createNanoEvents<ActorInspectorEmitterEvents>();

  constructor(accessors: () => ActorInspectorAccessors) {
    this.accessors = accessors();
  }
}
