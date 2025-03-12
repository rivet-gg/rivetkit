import { useEffect, useState } from 'react';
import { createClient, type ActorHandle } from 'actor-core/client';
import { type CursorRoom } from './cursor-room';
import CursorList from './components/CursorList';
import type { ActorCoreApp } from 'actor-core';

type App = ActorCoreApp<{
  "cursor-room": typeof CursorRoom;
}>;

function App() {
  const [cursorRoom, setCursorRoom] = useState<ActorHandle<typeof CursorRoom> | null>(null);
  const [username] = useState(() => `User ${Math.floor(Math.random() * 10000)}`);
  const [userId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        // Use local development URL
        const client = createClient<App>('http://localhost:8788/actors');
        const room = await client["cursor-room"].get();
        if (!mounted) return;
        setCursorRoom(room);
      } catch (error) {
        console.error("Failed to connect:", error);
      }
    }

    connect();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!cursorRoom) return;

    const throttledMouseMove = throttle((event: MouseEvent) => {
      cursorRoom.updateCursor(userId, event.clientX, event.clientY, username);
    }, 50);

    window.addEventListener('mousemove', throttledMouseMove);

    return () => {
      window.removeEventListener('mousemove', throttledMouseMove);
    };
  }, [cursorRoom, username, userId]);

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Live Cursors Demo</h1>
        <p className="text-lg mb-4">
          Move your cursor around to see it sync with other users in real-time.
        </p>
        <div className="text-sm text-gray-600">
          Connected as: {username}
        </div>
      </div>
      <CursorList />
    </div>
  );
}

// Utility function to throttle function calls
function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function(this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export default App; 