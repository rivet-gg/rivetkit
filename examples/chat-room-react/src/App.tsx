import { createClient } from "actor-core/client";
import { createReactActorCore } from "@actor-core/react";
import { useState, useEffect } from "react";
import type { App, Message } from "../actors/app";

const client = createClient<App>("http://localhost:6420");
const { useActor, useActorEvent } = createReactActorCore(client);

export default function ReactApp({ roomId = "general" }) {
  // Connect to specific chat room using tags
  const [{ actor }] = useActor("chatRoom", { 
    tags: { roomId }
  });
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  // Load initial state
  useEffect(() => {
    if (actor) {
      // Load chat history
      actor.getHistory().then(setMessages);
    }
  }, [actor]);

  // Listen for real-time updates from the server
  useActorEvent({ actor, event: "newMessage" }, (message) => {
    setMessages(prev => [...prev, message as Message]);
  });

  const sendMessage = () => {
    if (actor && input.trim()) {
      actor.sendMessage("User", input);
      setInput("");
    }
  };

  return (
    <div className="chat-container">
      <div className="room-header">
        <h3>Chat Room: {roomId}</h3>
      </div>
      
      <div className="messages">
        {messages.length === 0 ? (
          <div className="empty-message">No messages yet. Start the conversation!</div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="message">
              <b>{msg.sender}:</b> {msg.text}
              <span className="timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
      
      <div className="input-area">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder="Type a message..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}