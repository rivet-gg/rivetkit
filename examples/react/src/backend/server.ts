import { registry } from "./registry";
import { serve } from "@rivetkit/nodejs";

serve(registry, {
	cors: {
		// IMPORTANT: Configure origins in production
		origin: "*",
	},
});
