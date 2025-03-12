import { useEffect, useState } from 'react';
import { createClient, type ActorHandle } from 'actor-core/client';
import { type CursorRoom, type CursorState } from '../cursor-room';
import CursorList from './CursorList';
import type { ActorCoreApp } from 'actor-core';

type App = ActorCoreApp<{
  "cursor-room": typeof CursorRoom;
}>;

interface CursorEvent {
  id: string;
  cursor: CursorState;
}

function App() {
  const [cursorRoom, setCursorRoom] = useState<ActorHandle<typeof CursorRoom> | null>(null);
  const [cursors, setCursors] = useState<CursorRoom['cursors']>({});

  useEffect(() => {
    async function connect() {
      try {
        const client = await createClient<App>("http://localhost:6420");
        const room = await client["cursor-room"].get();
        setCursorRoom(room);

        // Subscribe to cursor events
        room.on("cursorMoved", (event: CursorEvent) => {
          setCursors(prev => ({
            ...prev,
            [event.id]: event.cursor
          }));
        });

        room.on("cursorAdded", (event: CursorEvent) => {
          setCursors(prev => ({
            ...prev,
            [event.id]: event.cursor
          }));
        });

        room.on("cursorRemoved", (id: string) => {
          setCursors(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        });

        // Get initial cursors
        const initialCursors = await room.getCursors();
        setCursors(initialCursors);
      } catch (e) {
        console.error("Failed to connect:", e);
      }
    }
    connect();
  }, []);

  useEffect(() => {
    if (!cursorRoom) return;

    const throttledMouseMove = throttle((event: MouseEvent) => {
      cursorRoom.updateCursor(event.clientX, event.clientY);
    }, 50);

    window.addEventListener('mousemove', throttledMouseMove);

    return () => {
      window.removeEventListener('mousemove', throttledMouseMove);
    };
  }, [cursorRoom]);

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Live Cursors Demo</h1>
        <p className="text-lg mb-4">
          Move your cursor around to see it sync with other users in real-time.
        </p>
      </div>
      <CursorList cursors={cursors} />
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