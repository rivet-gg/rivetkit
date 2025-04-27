import { createClient } from "actor-core/client";
import { createReactActorCore } from "@actor-core/react";
import { useState, useEffect } from "react";
import type { App } from "../actors/app";
import type { Message } from "../actors/app";

const client = createClient<App>("http://localhost:6420");
const { useActor, useActorEvent } = createReactActorCore(client);

function AIAssistant() {
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
      const userMessage = { role: "user", content: input, timestamp: Date.now() } as Message;
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

// Export the AIAssistant as the default React component
export default function ReactApp() {
  return (
    <div className="app">
      <h1>AI Assistant Demo</h1>
      <AIAssistant />
    </div>
  );
} 