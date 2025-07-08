import { actor } from "@rivetkit/actor";
import { authenticate } from "./my-utils";

export type Note = { id: string; content: string; updatedAt: number };

// User notes actor
const notes = actor({
	state: {
		notes: [] as Note[],
	},

	// Authenticate
	createConnState: async (c, { params }) => {
		const token = params.token;
		const userId = await authenticate(token);
		return { userId };
	},

	actions: {
		// Get all notes
		getNotes: (c) => c.state.notes,

		// Update note or create if it doesn't exist
		updateNote: (c, { id, content }) => {
			const noteIndex = c.state.notes.findIndex((note) => note.id === id);
			let note;

			if (noteIndex >= 0) {
				// Update existing note
				note = c.state.notes[noteIndex];
				note.content = content;
				note.updatedAt = Date.now();
				c.broadcast("noteUpdated", note);
			} else {
				// Create new note
				note = {
					id: id || `note-${Date.now()}`,
					content,
					updatedAt: Date.now(),
				};
				c.state.notes.push(note);
				c.broadcast("noteAdded", note);
			}

			return note;
		},

		// Delete note
		deleteNote: (c, { id }) => {
			const noteIndex = c.state.notes.findIndex((note) => note.id === id);
			if (noteIndex >= 0) {
				c.state.notes.splice(noteIndex, 1);
				c.broadcast("noteDeleted", { id });
			}
		},
	},
});

export default notes;
