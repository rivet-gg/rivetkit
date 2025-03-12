import { useEffect, useRef, useState } from "react";
import { useCursorRoom } from "../contexts/cursor-room";

interface Cursor {
  id: string;
  x: number;
  y: number;
  username: string;
}

export function CursorRoom() {
  const [state] = useCursorRoom();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursors, setCursors] = useState<Cursor[]>([]);

  useEffect(() => {
    if (state.state !== "created") return;

    // Get initial cursors
    state.actor.getCursors().then((value: unknown) => {
      if (Array.isArray(value) && value.every(isCursor)) {
        setCursors(value);
      }
    });

    // Listen for cursor updates
    state.actor.on("cursorMoved", (id: string, x: number, y: number, username: string) => {
      setCursors((prev) => {
        const newCursors = prev.filter((c) => c.id !== id);
        return [...newCursors, { id, x, y, username }];
      });
    });

    // Listen for cursor removals
    state.actor.on("cursorRemoved", (id: string) => {
      setCursors((prev) => prev.filter((c) => c.id !== id));
    });

    // Clean up listeners when component unmounts
    return () => {
      state.actor.dispose();
    };
  }, [state.state, state.actor]);

  // Handle mouse movement
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || state.state !== "created") return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    state.actor.updateCursor(
      "user-id", // TODO: Get real user ID
      x,
      y,
      "username" // TODO: Get real username
    );
  };

  if (state.state !== "created") {
    return <div>Loading...</div>;
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen bg-gray-100"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (state.state === "created") {
          state.actor.removeCursor("user-id"); // TODO: Get real user ID
        }
      }}
    >
      {cursors.map((cursor) => (
        <div
          key={cursor.id}
          className="absolute w-4 h-4 transform -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${cursor.x}%`,
            top: `${cursor.y}%`,
          }}
        >
          <div className="w-3 h-3 bg-blue-500 rounded-full" />
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-1 rounded">
            {cursor.username}
          </div>
        </div>
      ))}
    </div>
  );
}

function isCursor(value: unknown): value is Cursor {
  if (typeof value !== "object" || value === null) return false;
  const cursor = value as Record<string, unknown>;
  return (
    typeof cursor.id === "string" &&
    typeof cursor.x === "number" &&
    typeof cursor.y === "number" &&
    typeof cursor.username === "string"
  );
} 