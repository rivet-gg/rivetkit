// import { describe, test, expect, beforeAll, afterAll } from "vitest";
// import os from "node:os";
// import fs from "node:fs/promises";
// import path from "node:path";
// import { fileURLToPath } from "node:url";
// import { deployToRivet } from "./rivet-deploy";
// import { randomUUID } from "node:crypto";
//
// const __dirname = path.dirname(fileURLToPath(import.meta.url));
//
// // Simple counter worker definition to deploy
// const COUNTER_WORKER = `
// import { worker, setup } from "@rivetkit/core";
//
// const counter = worker({
//   state: { count: 0 },
//   actions: {
//     increment: (c, amount) => {
//       c.state.count += amount;
//       c.broadcast("newCount", c.state.count);
//       return c.state.count;
//     },
//     getCount: (c) => {
//       return c.state.count;
//     },
//   },
// });
//
// export const registry = setup({
//   workers: { counter },
// });
//
// export type Registry = typeof registry;
// `;
//
// test("Rivet deployment tests", async () => {
// 	const tempFilePath = path.join(os.tmpdir(), `registry-${randomUUID()}`);
// 	await fs.writeFile(tempFilePath, COUNTER_WORKER);
// 	await deployToRivet("test-registry", tempFilePath, true);
// });
