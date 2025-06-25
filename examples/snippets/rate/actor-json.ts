import { actor } from "@rivetkit/actor";

// Simple rate limiter - allows 5 requests per minute
const rateLimiter = actor({
  state: {
    count: 0,
    resetAt: 0
  },

  actions: {
    // Check if request is allowed
    checkLimit: (c) => {
      const now = Date.now();
      
      // Reset if expired
      if (now > c.state.resetAt) {
        c.state.count = 0;
        c.state.resetAt = now + 60000; // 1 minute window
      }
      
      // Check if under limit
      const allowed = c.state.count < 5;
      
      // Increment if allowed
      if (allowed) {
        c.state.count++;
      }
      
      return {
        allowed,
        remaining: 5 - c.state.count,
        resetsIn: Math.round((c.state.resetAt - now) / 1000)
      };
    }
  }
});

export default rateLimiter;
