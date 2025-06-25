// import { runDriverTests } from "@rivetkit/core/driver-test-suite";
// import { deployToRivet, rivetClientConfig } from "./rivet-deploy";
// import { RivetClientConfig, rivetRequest } from "../src/rivet-client";
// import invariant from "invariant";
//
// let deployProjectOnce: Promise<string> | undefined = undefined;
//
// // IMPORTANT: Unlike other tests, Rivet tests are ran without parallelism since we reuse the same shared environment. Eventually we can create an environment per test to create isolated instances.
// runDriverTests({
// 	useRealTimers: true,
// 	HACK_skipCleanupNet: true,
// 	async start(projectPath: string) {
// 		// Setup project
// 		if (!deployProjectOnce) {
// 			deployProjectOnce = deployToRivet(projectPath);
// 		}
// 		const endpoint = await deployProjectOnce;
//
// 		// Cleanup actors from previous tests
// 		await deleteAllActors(rivetClientConfig);
//
// 		// Flush cache since we manually updated the actors
// 		const res = await fetch(`${endpoint}/.test/rivet/flush-cache`, {
// 			method: "POST",
// 		});
// 		invariant(res.ok, `request failed: ${res.status}`);
//
// 		return {
// 			endpoint,
// 			async cleanup() {
// 				// This takes time and slows down tests -- it's fine if we leak actors that'll be cleaned up in the next run
// 				// await deleteAllActors(rivetClientConfig);
// 			},
// 		};
// 	},
// });
//
// async function deleteAllActors(clientConfig: RivetClientConfig) {
// 	// TODO: This is not paginated
//
// 	console.log("Listing actors to delete");
// 	const { actors } = await rivetRequest<
// 		void,
// 		{ actors: { id: string; tags: Record<string, string> }[] }
// 	>(clientConfig, "GET", "/actors");
//
// 	for (const actor of actors) {
// 		if (actor.tags.role !== "actor") continue;
//
// 		console.log(`Deleting actor ${actor.id} (${JSON.stringify(actor.tags)})`);
// 		await rivetRequest<void, void>(
// 			clientConfig,
// 			"DELETE",
// 			`/actors/${actor.id}`,
// 		);
// 	}
// }
