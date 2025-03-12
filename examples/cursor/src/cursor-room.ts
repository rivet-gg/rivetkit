import { actor, type ActionContext } from "actor-core";
import type { ActorHandle } from 'actor-core/client';

export interface CursorState {
  color: string;
  name?: string;
  x: number;
  y: number;
}

export interface CursorRoom {
  cursors: Record<string, CursorState>;
  getCursors(): Promise<Record<string, CursorState>>;
  updateCursor(x: number, y: number): Promise<void>;
  setName(name: string): Promise<void>;
  setColor(color: string): Promise<void>;
}

interface State {
  cursors: Record<string, CursorState>;
}

type Context = ActionContext<State, void, void, void>;

interface CursorActions {
  [key: string]: (ctx: Context, ...args: any[]) => any;
  getCursors(ctx: Context): Promise<Record<string, CursorState>>;
  updateCursor(ctx: Context, x: number, y: number): Promise<void>;
  setName(ctx: Context, name: string): Promise<void>;
  setColor(ctx: Context, color: string): Promise<void>;
}

export const CursorRoom = actor<State, void, void, void, CursorActions>({
  state: {
    cursors: {},
  },

  actions: {
    async getCursors(ctx) {
      return ctx.state.cursors;
    },

    async updateCursor(ctx, x: number, y: number) {
      const id = Array.from(ctx.conns.values())[0].id;
      const cursor = ctx.state.cursors[id] || {
        color: `hsl(${Math.random() * 360}, 70%, 50%)`,
        x: 0,
        y: 0,
      };

      ctx.state.cursors[id] = {
        ...cursor,
        x,
        y,
      };

      ctx.broadcast("cursorMoved", {
        id,
        cursor: ctx.state.cursors[id],
      });
    },

    async setName(ctx, name: string) {
      const id = Array.from(ctx.conns.values())[0].id;
      const cursor = ctx.state.cursors[id];
      if (cursor) {
        cursor.name = name;
        ctx.broadcast("cursorUpdated", {
          id,
          cursor,
        });
      }
    },

    async setColor(ctx, color: string) {
      const id = Array.from(ctx.conns.values())[0].id;
      const cursor = ctx.state.cursors[id];
      if (cursor) {
        cursor.color = color;
        ctx.broadcast("cursorUpdated", {
          id,
          cursor,
        });
      }
    },
  },

  onConnect(ctx) {
    const id = Array.from(ctx.conns.values())[0].id;
    ctx.state.cursors[id] = {
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
      x: 0,
      y: 0,
    };

    ctx.broadcast("cursorAdded", {
      id,
      cursor: ctx.state.cursors[id],
    });
  },

  onDisconnect(ctx) {
    const id = Array.from(ctx.conns.values())[0].id;
    delete ctx.state.cursors[id];
    ctx.broadcast("cursorRemoved", id);
  },
});