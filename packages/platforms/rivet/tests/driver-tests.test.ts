// TODO:

//import { runDriverTests } from "@actor-core/driver-test-suite";
//
//// Bypass createTestRuntime by providing an endpoint directly
//runDriverTests({
//	async start(appPath: string) {
//		// Get endpoint from environment or use a default for local testing
//		const endpoint = process.env.RIVET_ENDPOINT;
//
//		if (!endpoint) {
//			throw new Error("RIVET_ENDPOINT environment variable must be set");
//		}
//
//		return {
//			endpoint,
//			async cleanup() {
//				// Nothing to clean up - the test environment handles this
//			},
//		};
//	},
//});
