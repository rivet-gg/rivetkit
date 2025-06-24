import { createClient } from "@rivetkit/worker/client";
import { createReactRivetKit } from "@rivetkit/react";
import { useState, useEffect } from "react";

const client = createClient("http://localhost:6420");
const { useActor, useActorEvent } = createReactRivetKit(client);

export function NotesApp({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<Array<{ id: string, content: string }>>([]);
  const [newNote, setNewNote] = useState("");
  
  // Connect to actor with auth token
  const [{ actor }] = useActor("notes", { 
    params: { userId, token: "demo-token" }
  });
  
  // Load initial notes
  useEffect(() => {
    if (actor) {
      actor.getNotes().then(setNotes);
    }
  }, [actor]);
  
  // Add a new note
  const addNote = async () => {
    if (actor && newNote.trim()) {
      await actor.updateNote({ id: `note-${Date.now()}`, content: newNote });
      setNewNote("");
    }
  };
  
  // Delete a note
  const deleteNote = (id: string) => {
    if (actor) {
      actor.deleteNote({ id });
    }
  };
  
  // Listen for realtime updates
  useActorEvent({ actor, event: "noteAdded" }, (note) => {
    setNotes(notes => [...notes, note]);
  });
  
  useActorEvent({ actor, event: "noteUpdated" }, (updatedNote) => {
    setNotes(notes => notes.map(note => 
      note.id === updatedNote.id ? updatedNote : note
    ));
  });
  
  useActorEvent({ actor, event: "noteDeleted" }, ({ id }) => {
    setNotes(notes => notes.filter(note => note.id !== id));
  });
  
  return (
    <div>
      <h2>My Notes</h2>
      
      <div>
        <input 
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="Enter a new note"
        />
        <button onClick={addNote}>Add</button>
      </div>
      
      <ul>
        {notes.map(note => (
          <li key={note.id}>
            {note.content}
            <button onClick={() => deleteNote(note.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
