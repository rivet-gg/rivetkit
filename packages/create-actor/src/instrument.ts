import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

// Ensure to call this before requiring any other modules!
Sentry.init({
	dsn: process.env.SENTRY_DSN,
	integrations: [
		// Add our Profiling integration
		nodeProfilingIntegration(),
	],
});
