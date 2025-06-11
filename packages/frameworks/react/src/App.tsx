import { useState } from "react";
import type { Registry } from "../../../../examples/chat-room/actors/app";
import { createClient, createRivetKit } from "../lib/mod";

const client = createClient<Registry>("http://localhost:6420", {
	encoding: "json",
});

const { useWorker } = createRivetKit(client);

function App() {
	const [state, setState] = useState(0);

	return (
		<>
			<button
				type="button"
				onClick={() => {
					setState((prev) => (prev ? prev + 1 : 1));
				}}
			>
				Increment State {state}
			</button>
			<h1>Rivet Kit + React</h1>
			<div
				style={{
					display: "grid",
					gap: "1rem",
					gridTemplateColumns: "repeat(3, 1fr)",
				}}
			>
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerReceiver key="abc" params={{ room: "abc" }} />
				<WorkerWriter key="abc" params={{ room: "abc" }} />
			</div>
		</>
	);
}

function WorkerReceiver({ key, params }: { key: string; params: any } = {}) {
	const worker = useWorker({
		name: "chatRoom",
		key,
		params,
	});

	const { connection, handle, ...rest } = worker || {};

	worker.useEvent("newMessage", (...args) => {
		console.log("Received message from worker:", ...args);
	});

	return (
		<div>
			<h2>Worker Component</h2>
			<pre>{JSON.stringify(rest, null, 2)}</pre>
		</div>
	);
}

function WorkerWriter({ key, params }: { key: string; params: any }) {
	const worker = useWorker({
		name: "chatRoom",
		key,
		params,
	});
	return (
		<div>
			<h2>Worker Writer Component</h2>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					const formData = new FormData(e.target as HTMLFormElement);
					const message = formData.get("message") as string;
					worker.connection?.sendMessage("username", message);
					(e.target as HTMLFormElement).reset();
				}}
			>
				<input type="text" name="message" placeholder="Type your message" />
				<button type="submit">Send</button>
			</form>
		</div>
	);
}

export default App;
