import { actor, setup } from "actor-core";

export type Message = { sender: string; text: string; timestamp: number; }

export const chatRoom = actor({
  // State is automatically persisted
  state: { 
    messages: [] as Message[] 
  },

  actions: {
    sendMessage: (c, sender: string, text: string) => {
      const message = { sender, text, timestamp: Date.now() };
      
      // Any changes to state are automatically saved
      c.state.messages.push(message);
      
      // Broadcast events trigger real-time updates in connected clients
      c.broadcast("newMessage", message);
    },

    getHistory: (c) => c.state.messages
  }
});

// Create and export the app
export const app = setup({
	actors: { chatRoom },
});

// Export type for client type checking
export type App = typeof app;
