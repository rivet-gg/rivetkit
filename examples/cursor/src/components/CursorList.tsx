import React from 'react';
import { type CursorState } from '../cursor-room';

interface CursorListProps {
  cursors: Record<string, CursorState>;
}

export default function CursorList({ cursors }: CursorListProps) {
  return (
    <div className="fixed top-4 right-4 bg-white/90 p-4 rounded-lg shadow-lg max-w-xs">
      <h2 className="text-lg font-semibold mb-2">Connected Cursors</h2>
      <ul className="space-y-2">
        {Object.entries(cursors).map(([id, cursor]) => (
          <li key={id} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: cursor.color }}
            />
            <span>
              {cursor.name || 'Anonymous'} ({Math.round(cursor.x)}, {Math.round(cursor.y)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
} 