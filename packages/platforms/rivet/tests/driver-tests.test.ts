import { runDriverTests } from "@actor-core/driver-test-suite";
import { deployToRivet, RIVET_CLIENT_CONFIG } from "./rivet-deploy";
import { type RivetClientConfig, rivetRequest } from "../src/rivet_client";
import invariant from "invariant";

let alreadyDeployedManager = false;
const alreadyDeployedApps = new Set();
let managerEndpoint: string | undefined = undefined;

const driverTestConfig = {
	useRealTimers: true,
	HACK_skipCleanupNet: true,
	async start(appPath: string) {
		console.log("Starting test", {
			alreadyDeployedManager,
			alreadyDeployedApps,
			managerEndpoint,
		});

		// Cleanup actors from previous tests
		await deleteAllActors(RIVET_CLIENT_CONFIG, !alreadyDeployedManager);

		if (!alreadyDeployedApps.has(appPath)) {
			console.log(`Starting Rivet driver tests with app: ${appPath}`);

			// Deploy to Rivet
			const result = await deployToRivet(appPath, !alreadyDeployedManager);
			console.log(
				`Deployed to Rivet at ${result.endpoint} (manager: ${!alreadyDeployedManager})`,
			);

			// Save as deployed
			managerEndpoint = result.endpoint;
			alreadyDeployedApps.add(appPath);
			alreadyDeployedManager = true;
		} else {
			console.log(`Already deployed: ${appPath}`);
		}

		invariant(managerEndpoint, "missing manager endpoint");
		return {
			endpoint: managerEndpoint,
			async cleanup() {
				await deleteAllActors(RIVET_CLIENT_CONFIG, false);
			},
		};
	},
};

async function deleteAllActors(
	clientConfig: RivetClientConfig,
	deleteManager: boolean,
) {
	console.log("Listing actors to delete");
	const { actors } = await rivetRequest<
		void,
		{ actors: { id: string; tags: Record<string, string> }[] }
	>(clientConfig, "GET", "/actors");

	for (const actor of actors) {
		if (!deleteManager && actor.tags.name === "manager") continue;

		console.log(`Deleting actor ${actor.id} (${JSON.stringify(actor.tags)})`);
		await rivetRequest<void, void>(
			clientConfig,
			"DELETE",
			`/actors/${actor.id}`,
		);
	}
}

// Run the driver tests with our config
runDriverTests(driverTestConfig);
