import { actor, setup } from "@rivetkit/actor";
import * as Y from "yjs";
import { applyUpdate, encodeStateAsUpdate } from "yjs";

export const yjsDocument = actor({
	onAuth: () => {},
	// Persistent state that survives restarts: https://rivet.gg/docs/actors/state
	state: {
		docData: "", // Base64 encoded Yjs document
		lastModified: 0,
	},

	createVars: () => ({
		doc: new Y.Doc(),
	}),

	onStart: (c) => {
		if (c.state.docData) {
			const binary = atob(c.state.docData);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			applyUpdate(c.vars.doc, bytes);
		}
	},

	// Handle client connections: https://rivet.gg/docs/actors/connection-lifecycle
	onConnect: (c, conn) => {
		const update = encodeStateAsUpdate(c.vars.doc);
		const base64 = bufferToBase64(update);
		conn.send("initialState", { update: base64 });
	},

	actions: {
		// Callable functions from clients: https://rivet.gg/docs/actors/actions
		applyUpdate: (c, updateBase64: string) => {
			const binary = atob(updateBase64);
			const update = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				update[i] = binary.charCodeAt(i);
			}

			applyUpdate(c.vars.doc, update);

			const fullState = encodeStateAsUpdate(c.vars.doc);
			// State changes are automatically persisted
			c.state.docData = bufferToBase64(fullState);
			c.state.lastModified = Date.now();

			// Send events to all connected clients: https://rivet.gg/docs/actors/events
			c.broadcast("update", { update: updateBase64 });
		},

		getState: (c) => ({
			docData: c.state.docData,
			lastModified: c.state.lastModified,
		}),
	},
});

function bufferToBase64(buffer: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < buffer.byteLength; i++) {
		binary += String.fromCharCode(buffer[i]);
	}
	return btoa(binary);
}

// Register actors for use: https://rivet.gg/docs/setup
export const registry = setup({
	use: { yjsDocument },
});
