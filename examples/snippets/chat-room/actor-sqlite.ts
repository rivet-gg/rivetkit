import { actor } from "@rivetkit/actor";
import { drizzle } from "@rivetkit/drizzle";
import { messages } from "./schema";

export type Message = { sender: string; text: string; timestamp: number; }

const chatRoom = actor({
  sql: drizzle(),

  actions: {
    sendMessage: async (c, sender: string, text: string) => {
      const message = {
        sender,
        text,
        timestamp: Date.now(),
      };

      // Insert the message into SQLite
      await c.db.insert(messages).values(message);
      
      // Broadcast to all connected clients
      c.broadcast("newMessage", message);
      
      // Return the created message (matches JS memory version)
      return message;
    },

    getHistory: async (c) => {
      // Query all messages ordered by timestamp
      const result = await c.db
        .select()
        .from(messages)
        .orderBy(messages.timestamp);
      
      return result as Message[];
    }
  }
});

export default chatRoom;
