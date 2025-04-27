import { actor } from "actor-core";
import { drizzle } from "@actor-core/drizzle";
import { documents, cursors } from "./schema";

export type Cursor = { x: number, y: number, userId: string };

export type CursorUpdateEvent = { userId: string, x: number, y: number };

export type TextUpdatedEvent = { text: string, userId: string };

export type UserDisconnectedEvent = { userId: string };

const document = actor({
  sql: drizzle(),

  onDisconnect: async (c, conn) => {
    console.log("onDisconnect(): " + conn.id);
    await c.db
      .delete(documents)
      .where({ userId: conn.id })
      .execute();
    
    // Broadcast removal
    c.broadcastWithOptions(
      { exclude: [conn.id] },
      "userDisconnected",
      {
        userId: conn.id
      } as UserDisconnectedEvent
    );
  },

  actions: {
    getText: async (c) => {
      const doc = await c.db
        .select()
        .from(documents)
        .get();
      
      return doc?.text || "";
    },

    // Update the document (real use case has better conflict resolution)
    setText: async (c, text: string) => {
      // Save document state
      await c.db
        .insert(documents)
        .values({
          text
        })
        .onConflictDoUpdate({
          target: documents.id,
          set: {
            text
          }
        });
      
      // Broadcast update
      c.broadcastWithOptions(
        { excludeSelf: true },
        "textUpdated", 
        {
          text,
          userId: c.conn.id
        } as TextUpdatedEvent
      );
    },

    getCursors: async (c) => {
      const result = await c.db
        .select()
        .from(cursors);
      
      // Convert array to record object keyed by userId
      return result.reduce((acc, cursor) => {
        acc[cursor.userId] = {
          x: cursor.x,
          y: cursor.y,
          userId: cursor.userId
        };
        return acc;
      }, {} as Record<string, Cursor>);
    },
    
    updateCursor: async (c, x: number, y: number) => {
      // Update user location
      const userId = c.conn.id;
      
      await c.db
        .insert(cursors)
        .values({
          userId,
          x,
          y
        })
        .onConflictDoUpdate({
          target: cursors.userId,
          set: {
            x,
            y
          }
        });
      
      // Broadcast location
      c.broadcastWithOptions(
        { excludeSelf: true },
        "cursorUpdated", 
        {
          userId,
          x, 
          y
        } as CursorUpdateEvent
      );
    },
  }
});

export default document;