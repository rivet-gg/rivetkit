import { actor } from "@rivetkit/actor";
import { drizzle } from "@rivetkit/drizzle";
import * as Y from 'yjs';
import { encodeStateAsUpdate, applyUpdate } from 'yjs';
import { documents } from "./schema";

const yjsDocument = actor({
  sql: drizzle(),
  
  // In-memory Yjs objects (not serialized)
  createVars: () => ({
    doc: new Y.Doc()
  }),
  
  // Initialize document from state when actor starts
  onStart: async (c) => {
    // Get document data from database
    const documentData = await c.db
      .select()
      .from(documents)
      .get();
      
    if (documentData?.docData) {
      try {
        // Parse the docData from string to binary
        const binary = atob(documentData.docData);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        applyUpdate(c.vars.doc, bytes);
      } catch (error) {
        console.error("Failed to load document", error);
      }
    }
  },
  
  // Handle client connections
  onConnect: (c) => {
    // Send initial document state to client
    const update = encodeStateAsUpdate(c.vars.doc);
    const base64 = bufferToBase64(update);
    
    c.conn.send("initialState", { update: base64 });
  },

  actions: {
    // Apply a Yjs update from a client
    applyUpdate: async (c, updateBase64: string) => {
      try {
        // Convert base64 to binary
        const binary = atob(updateBase64);
        const update = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          update[i] = binary.charCodeAt(i);
        }
        
        // Apply update to Yjs document
        applyUpdate(c.vars.doc, update);
        
        // Save document state to database
        const fullState = encodeStateAsUpdate(c.vars.doc);
        const docData = bufferToBase64(fullState);
        
        // Store in database
        await c.db
          .insert(documents)
          .values({
            docData
          })
          .onConflictDoUpdate({
            target: documents.id,
            set: {
              docData
            }
          });
        
        // Broadcast to all clients
        c.broadcast("update", { update: updateBase64 });
      } catch (error) {
        console.error("Failed to apply update", error);
      }
    }
  }
});

// Helper to convert ArrayBuffer to base64
function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

export default yjsDocument;
