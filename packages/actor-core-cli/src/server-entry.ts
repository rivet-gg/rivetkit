import { validateConfig } from "./utils/config";
import { serve } from "@actor-core/nodejs";

async function run() {
	const config = await validateConfig(process.cwd(), process.env.APP_PATH!);
	config.app.config.inspector = {
		enabled: true,
	};
	config.app.config.cors = {
		origin: (origin) => origin,
	};
	serve(config.app, {
		port: Number.parseInt(process.env.PORT || "6420", 10) || 6420,
	});
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
