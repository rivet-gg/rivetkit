import { createClient } from "@rivetkit/actor/client";
import { createReactRivetKit } from "@rivetkit/react";
import { useState, useEffect } from "react";
import type { Registry } from "../actors/registry";
import type { Message } from "./actor";

const client = createClient<Registry>("http://localhost:8080");
const { useActor, useActorEvent } = createReactRivetKit(client);

export function AIAssistant() {
  const [{ actor }] = useActor("aiAgent", { tags: { conversationId: "default" } });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Load initial messages
  useEffect(() => {
    if (actor) {
      actor.getMessages().then(setMessages);
    }
  }, [actor]);

  // Listen for real-time messages
  useActorEvent({ actor, event: "messageReceived" }, (message) => {
    setMessages(prev => [...prev, message as Message]);
    setIsLoading(false);
  });

  const handleSendMessage = async () => {
    if (actor && input.trim()) {
      setIsLoading(true);
      
      // Add user message to UI immediately
      const userMessage = { role: "user", content: input } as Message;
      setMessages(prev => [...prev, userMessage]);
      
      // Send to actor (AI response will come through the event)
      await actor.sendMessage(input);
      setInput("");
    }
  };

  return (
    <div className="ai-chat">
      <div className="messages">
        {messages.length === 0 ? (
          <div className="empty-message">
            Ask the AI assistant a question to get started
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="avatar">
                {msg.role === "user" ? "👤" : "🤖"}
              </div>
              <div className="content">{msg.content}</div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="message assistant loading">
            <div className="avatar">🤖</div>
            <div className="content">Thinking...</div>
          </div>
        )}
      </div>
      
      <div className="input-area">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyPress={e => e.key === "Enter" && handleSendMessage()}
          placeholder="Ask the AI assistant..."
          disabled={isLoading}
        />
        <button 
          onClick={handleSendMessage}
          disabled={isLoading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
