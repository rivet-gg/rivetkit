import { logger } from "./log";
import type { SSEStreamingApi } from "hono/streaming";
import type { EventSource } from "eventsource";

/**
 * FakeEventSource provides a minimal implementation of an SSE stream
 * that handles events for the inline client driver
 */
export class FakeEventSource {
  url = "http://internal-sse-endpoint";
  readyState = 1; // OPEN
  withCredentials = false;
  
  // Event handlers
  onopen: ((this: EventSource, ev: Event) => any) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => any) | null = null;
  onerror: ((this: EventSource, ev: Event) => any) | null = null;
  
  // Private event listeners
  #listeners: Record<string, Set<EventListener>> = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set()
  };
  
  // Stream that will be passed to the handler
  #stream: SSEStreamingApi;
  #onCloseCallback: () => Promise<void>;
  
  /**
   * Creates a new FakeEventSource
   */
  constructor(onCloseCallback: () => Promise<void>) {
    this.#onCloseCallback = onCloseCallback;
    
    this.#stream = this.#createStreamApi();
    
    // Trigger open event on next tick
    setTimeout(() => {
      if (this.readyState === 1) {
        this.#dispatchEvent('open');
      }
    }, 0);
    
    logger().debug("FakeEventSource created");
  }
  
  // Creates the SSE streaming API implementation
  #createStreamApi(): SSEStreamingApi {
    // Create self-reference for closures
    const self = this;
    
    const streamApi: SSEStreamingApi = {
      write: async (input) => {
        const data = typeof input === "string" ? input : new TextDecoder().decode(input);
        self.#dispatchEvent('message', { data });
        return streamApi;
      },
      
      writeln: async (input: string) => {
        await streamApi.write(input + "\n");
        return streamApi;
      },
      
      writeSSE: async (message: { data: string | Promise<string>, event?: string, id?: string, retry?: number }): Promise<void> => {
        const data = await message.data;
        
        if (message.event) {
          self.#dispatchEvent(message.event, { data });
        } else {
          self.#dispatchEvent('message', { data });
        }
      },
      
      sleep: async (ms: number) => {
        await new Promise(resolve => setTimeout(resolve, ms));
        return streamApi;
      },
      
      close: async () => {
        self.close();
      },
      
      pipe: async (_body: ReadableStream) => {
        // No-op implementation
      },
      
      onAbort: async (cb: () => void) => {
        self.addEventListener("error", () => {
          cb();
        });
        return streamApi;
      },
      
      abort: async () => {
        self.#dispatchEvent('error');
        return streamApi;
      },
      
      // Additional required properties
      get responseReadable() {
        return null as unknown as ReadableStream;
      },
      
      get aborted() {
        return self.readyState === 2; // CLOSED
      },
      
      get closed() {
        return self.readyState === 2; // CLOSED
      }
    };
    
    return streamApi;
  }
  
  /**
   * Closes the connection
   */
  close(): void {
    if (this.readyState === 2) { // CLOSED
      return;
    }
    
    logger().debug("closing FakeEventSource");
    this.readyState = 2; // CLOSED
    
    // Call the close callback
    this.#onCloseCallback().catch(err => {
      logger().error("error in onClose callback", { error: err });
    });
    
    // Dispatch close event
    this.#dispatchEvent('close');
  }
  
  /**
   * Get the stream API to pass to the handler
   */
  getStream(): SSEStreamingApi {
    return this.#stream;
  }
  
  // Implementation of EventTarget-like interface
  addEventListener(type: string, listener: EventListener): void {
    if (!this.#listeners[type]) {
      this.#listeners[type] = new Set();
    }
    this.#listeners[type].add(listener);
    
    // Map to onX properties as well
    if (type === "open" && typeof listener === "function" && !this.onopen) {
      this.onopen = listener as any;
    } else if (type === "message" && typeof listener === "function" && !this.onmessage) {
      this.onmessage = listener as any;
    } else if (type === "error" && typeof listener === "function" && !this.onerror) {
      this.onerror = listener as any;
    }
  }
  
  removeEventListener(type: string, listener: EventListener): void {
    if (this.#listeners[type]) {
      this.#listeners[type].delete(listener);
    }
    
    // Unset onX property if it matches
    if (type === "open" && this.onopen === listener) {
      this.onopen = null;
    } else if (type === "message" && this.onmessage === listener) {
      this.onmessage = null;
    } else if (type === "error" && this.onerror === listener) {
      this.onerror = null;
    }
  }
  
  // Internal method to dispatch events
  #dispatchEvent(type: string, detail?: Record<string, any>): void {
    // Create appropriate event
    let event: Event;
    if (type === 'message' || detail) {
      event = new MessageEvent(type, detail);
    } else {
      event = new Event(type);
    }
    
    // Call specific handler
    if (type === 'open' && this.onopen) {
      try {
        this.onopen.call(this as any, event);
      } catch (err) {
        logger().error("error in onopen handler", { error: err });
      }
    } else if (type === 'message' && this.onmessage) {
      try {
        this.onmessage.call(this as any, event as MessageEvent);
      } catch (err) {
        logger().error("error in onmessage handler", { error: err });
      }
    } else if (type === 'error' && this.onerror) {
      try {
        this.onerror.call(this as any, event);
      } catch (err) {
        logger().error("error in onerror handler", { error: err });
      }
    }
    
    // Call all listeners
    if (this.#listeners[type]) {
      for (const listener of this.#listeners[type]) {
        try {
          listener.call(this, event);
        } catch (err) {
          logger().error(`error in ${type} event listener`, { error: err });
        }
      }
    }
  }
}
