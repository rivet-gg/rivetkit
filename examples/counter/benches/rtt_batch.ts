//import { spawn, execSync } from "node:child_process";
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
//bench(
//	`rtt x $count (${runtime}, $encoding, $transport)`,
//	async function* (state) {
//		const totalCount = state.get("count");
//
//		// Flush DB
//		execSync("docker exec redis-server redis-cli flushdb");
//
//		// Start server in the background
//		const serverProcess = spawn(isBun ? "bun" : "tsx", ["src/index.ts"], {
//			cwd: path.resolve(__dirname, `../platforms/${isBun ? "bun" : "nodejs"}`),
//			detached: true,
//			stdio: "ignore",
//		});
//
//		// Give process time to boot
//		await new Promise((resolve) => setTimeout(resolve, 500));
//
//		const client = new Client(`http://localhost:${process.env.PORT ?? 6420}`, {
//			transport: state.get("transport"),
//			encoding: state.get("encoding"),
//		});
//
//		const testId = crypto.randomUUID();
//		const counter = await client.get<Counter>({ name: "counter", testId });
//
//		const { promise, resolve } = Promise.withResolvers<undefined>();
//
//		yield async () => {
//			// Wait for events to respond
//			let receivedEvents = 0;
//			counter.on("newCount", () => {
//				receivedEvents++;
//				if (receivedEvents === totalCount) resolve();
//			});
//
//			// Measure the throughput of calling increment
//			for (let i = 0; i < totalCount; i++) {
//				await counter.increment(1);
//			}
//
//			await promise;
//		};
//
//		await counter.disconnect();
//
//		// Kill the server process
//		serverProcess.kill("SIGKILL");
//	},
//)
//	.gc("inner")
//	.args("encoding", ["cbor", "json"])
//	.args("transport", ["websocket"/*, "sse"*/])
//	.args("count", [1, 128, 1024]);
////.args("count", [1, 2 ** 4, 2 ** 8]);
//
//await run();
