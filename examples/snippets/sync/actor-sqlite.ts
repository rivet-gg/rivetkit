import { actor } from "@rivetkit/actor";
import { drizzle } from "@rivetkit/drizzle";
import { contacts } from "./schema";

export type Contact = { id: string; name: string; email: string; phone: string; updatedAt: number; }

const contactSync = actor({
  sql: drizzle(),
  
  actions: {
    // Gets changes after the last timestamp (when coming back online)
    getChanges: async (c, after: number = 0) => {
      const changes = await c.db
        .select()
        .from(contacts)
        .where(contacts.updatedAt.gt(after));
      
      return { 
        changes,
        timestamp: Date.now()
      };
    },
    
    // Pushes new changes from the client & handles conflicts
    pushChanges: async (c, contactList: Contact[]) => {
      let changed = false;
      
      for (const contact of contactList) {
        // Check if contact exists with a newer timestamp
        const existing = await c.db
          .select()
          .from(contacts)
          .where(contacts.id.equals(contact.id))
          .get();
        
        if (!existing || existing.updatedAt < contact.updatedAt) {
          // Insert or update the contact
          await c.db
            .insert(contacts)
            .values(contact)
            .onConflictDoUpdate({
              target: contacts.id,
              set: contact
            });
          
          changed = true;
        }
      }
      
      if (changed) {
        // Get all contacts to broadcast
        const allContacts = await c.db
          .select()
          .from(contacts);
        
        c.broadcast("contactsChanged", { 
          contacts: allContacts
        });
      }
      
      return { timestamp: Date.now() };
    }
  }
});

export default contactSync;
