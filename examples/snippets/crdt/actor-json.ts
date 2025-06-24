import { actor } from "@rivetkit/worker";
import * as Y from 'yjs';
import { encodeStateAsUpdate, applyUpdate } from 'yjs';

const yjsDocument = actor({
  // State: just the serialized Yjs document data
  state: {
    docData: "", // Base64 encoded Yjs document
    lastModified: 0
  },
  
  // In-memory Yjs objects (not serialized)
  createVars: () => ({
    doc: new Y.Doc()
  }),
  
  // Initialize document from state when actor starts
  onStart: (c) => {
    if (c.state.docData) {
      const binary = atob(c.state.docData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      applyUpdate(c.vars.doc, bytes);
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
    applyUpdate: (c, updateBase64: string) => {
      // Convert base64 to binary
      const binary = atob(updateBase64);
      const update = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        update[i] = binary.charCodeAt(i);
      }
      
      // Apply update to Yjs document
      applyUpdate(c.vars.doc, update);
      
      // Save document state
      const fullState = encodeStateAsUpdate(c.vars.doc);
      c.state.docData = bufferToBase64(fullState);
      c.state.lastModified = Date.now();
      
      // Broadcast to all clients
      c.broadcast("update", { update: updateBase64 });
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
