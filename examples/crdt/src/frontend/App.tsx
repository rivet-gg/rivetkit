import { createClient, createRivetKit } from "@rivetkit/react";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import type { registry } from "../backend/registry";

const client = createClient<typeof registry>("http://localhost:8080");
const { useActor } = createRivetKit(client);

function YjsEditor({ documentId }: { documentId: string }) {
	const yjsDocument = useActor({
		name: "yjsDocument",
		key: [documentId],
	});

	const [isLoading, setIsLoading] = useState(true);
	const [text, setText] = useState("");

	const yDocRef = useRef<Y.Doc | null>(null);
	const updatingFromServer = useRef(false);
	const updatingFromLocal = useRef(false);
	const observationInitialized = useRef(false);

	useEffect(() => {
		const yDoc = new Y.Doc();
		yDocRef.current = yDoc;
		setIsLoading(false);

		return () => {
			yDoc.destroy();
		};
	}, [yjsDocument.connection]);

	useEffect(() => {
		const yDoc = yDocRef.current;
		if (!yDoc || observationInitialized.current) return;

		const yText = yDoc.getText("content");

		yText.observe(() => {
			if (!updatingFromServer.current) {
				setText(yText.toString());

				if (yjsDocument.connection && !updatingFromLocal.current) {
					updatingFromLocal.current = true;

					const update = encodeStateAsUpdate(yDoc);
					const base64 = bufferToBase64(update);
					yjsDocument.connection.applyUpdate(base64).finally(() => {
						updatingFromLocal.current = false;
					});
				}
			}
		});

		observationInitialized.current = true;
	}, [yjsDocument.connection]);

	yjsDocument.useEvent("initialState", ({ update }: { update: string }) => {
		const yDoc = yDocRef.current;
		if (!yDoc) return;

		updatingFromServer.current = true;

		try {
			const binary = atob(update);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}

			applyUpdate(yDoc, bytes);

			const yText = yDoc.getText("content");
			setText(yText.toString());
		} catch (error) {
			console.error("Error applying initial update:", error);
		} finally {
			updatingFromServer.current = false;
		}
	});

	yjsDocument.useEvent("update", ({ update }: { update: string }) => {
		const yDoc = yDocRef.current;
		if (!yDoc) return;

		updatingFromServer.current = true;

		try {
			const binary = atob(update);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}

			applyUpdate(yDoc, bytes);

			const yText = yDoc.getText("content");
			setText(yText.toString());
		} catch (error) {
			console.error("Error applying update:", error);
		} finally {
			updatingFromServer.current = false;
		}
	});

	const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		if (!yDocRef.current) return;

		const newText = e.target.value;
		const yText = yDocRef.current.getText("content");

		if (newText !== yText.toString()) {
			updatingFromLocal.current = true;

			yDocRef.current.transact(() => {
				yText.delete(0, yText.length);
				yText.insert(0, newText);
			});

			updatingFromLocal.current = false;
		}
	};

	if (isLoading) {
		return <div className="loading">Loading collaborative document...</div>;
	}

	return (
		<div className="editor-container">
			<div className="editor-header">
				<h3>Document: {documentId}</h3>
				<div className={`connection-status ${yjsDocument.connection ? 'connected' : 'disconnected'}`}>
					{yjsDocument.connection ? 'Connected' : 'Disconnected'}
				</div>
			</div>
			<textarea
				value={text}
				onChange={handleTextChange}
				placeholder="Start typing... All changes are synchronized in real-time with other users!"
				className="collaborative-textarea"
			/>
		</div>
	);
}

export function App() {
	const [documentId, setDocumentId] = useState("shared-doc");
	const [inputDocId, setInputDocId] = useState("shared-doc");

	const switchDocument = () => {
		setDocumentId(inputDocId);
	};

	return (
		<div className="app-container">
			<div className="header">
				<h1>CRDT Collaborative Editor</h1>
				<p>Real-time collaborative text editing powered by Yjs and RivetKit</p>
			</div>

			<div className="info-box">
				<h4>How it works</h4>
				<p>
					This editor uses Conflict-free Replicated Data Types (CRDTs) with Yjs to enable 
					real-time collaborative editing. Open multiple browser tabs or share the URL 
					with others to see live collaboration in action!
				</p>
			</div>

			<div className="document-controls">
				<label>Document ID:</label>
				<input
					type="text"
					value={inputDocId}
					onChange={(e) => setInputDocId(e.target.value)}
					placeholder="Enter document ID"
				/>
				<button onClick={switchDocument}>
					Switch Document
				</button>
			</div>

			<YjsEditor key={documentId} documentId={documentId} />
		</div>
	);
}

function bufferToBase64(buffer: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < buffer.byteLength; i++) {
		binary += String.fromCharCode(buffer[i]);
	}
	return btoa(binary);
}