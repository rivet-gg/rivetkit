//import path from "node:path";
//import { fileURLToPath } from "node:url";
//import { bench, run } from "mitata";
//import { Client } from "actor-core/client";
//import type Counter from "../src/counter.ts";
//
//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);
//const isBun = typeof Bun !== "undefined";
//const runtime = isBun ? "bun" : "node";
//
//bench(`rpc (${runtime}, $encoding, $transport)`, async function* (state) {
//	const client = new Client(`http://localhost:${process.env.PORT ?? 8787}`, {
//		transport: state.get("transport"),
//		encoding: state.get("encoding"),
//	});
//
//	const testId = crypto.randomUUID();
//	const counter = await client.get<Counter>({ name: "counter", testId });
//
//	yield async () => {
//		await counter.increment(1);
//	};
//
//	await counter.disconnect();
//})
//	.gc("inner")
//	.args("encoding", ["cbor", "json"])
//	.args("transport", ["websocket"/*, "sse"*/]);
//
//run();
