import { actor } from "actor-core";

export type Message = { sender: string; text: string; timestamp: number; }

const chatRoom = actor({
  // State is automatically persisted
  state: { 
    messages: [] as Message[] 
  },

  // Initialize the room
  createState: () => ({
    messages: []
  }),

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

export default chatRoom;