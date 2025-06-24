import { actor } from "@rivetkit/worker";
import { drizzle } from "@rivetkit/drizzle";
import { streams, streamValues } from "./schema";

export type StreamState = { topValues: number[]; };

// Simple top-K stream processor example
const streamProcessor = actor({
  sql: drizzle(),

  actions: {
    getTopValues: async (c) => {
      // Get the top 3 values sorted in descending order
      const result = await c.db
        .select()
        .from(streamValues)
        .orderBy(streamValues.value.desc())
        .limit(3);
      
      return result.map(r => r.value);
    },

    // Add value and keep top 3
    addValue: async (c, value: number) => {
      // Insert the new value
      await c.db
        .insert(streamValues)
        .values({
          value
        });
      
      // Get the updated top 3 values
      const topValues = await c.db
        .select()
        .from(streamValues)
        .orderBy(streamValues.value.desc())
        .limit(3);
      
      // Delete values that are no longer in the top 3
      if (topValues.length === 3) {
        await c.db
          .delete(streamValues)
          .where(streamValues.value.lt(topValues[2].value));
      }
      
      const topValuesArray = topValues.map(r => r.value);
      
      // Broadcast update to all clients
      c.broadcast("updated", { topValues: topValuesArray });
      
      return topValuesArray;
    },
  }
});

export default streamProcessor;
