import { actor } from "@rivetkit/worker";
import { drizzle } from "@rivetkit/drizzle";
import { members, invoices } from "./schema";
import { authenticate } from "./my-utils";

// Simple tenant organization actor
const tenant = actor({
  sql: drizzle(),

  // Authentication
  createConnState: async (c, { params }) => {
    const token = params.token;
    const userId = await authenticate(token);
    return { userId };
  },

  actions: {
    // Get all members
    getMembers: async (c) => {
      const result = await c.db
        .select()
        .from(members);
      
      return result;
    },

    // Get all invoices (only admin can access)
    getInvoices: async (c) => {
      // Find the user's role by their userId
      const userId = c.conn.userId;
      const user = await c.db
        .select()
        .from(members)
        .where(members.id.equals(userId))
        .get();
      
      // Only allow admins to see invoices
      if (!user || user.role !== "admin") {
        throw new Error("Permission denied: requires admin role");
      }
      
      const result = await c.db
        .select()
        .from(invoices);
      
      return result;
    }
  }
});

export default tenant;
