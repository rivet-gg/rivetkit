import * as path from "node:path";
import { Argument, Command, Option } from "commander";
import { workflow } from "../workflow";

import { validateConfigTask } from "../workflows/validate-config";
import { serve } from "@actor-core/nodejs";
import chokidar from "chokidar";
import { Text } from "ink";
import open from "open";
import { withResolvers } from "../utils/mod";

export const dev = new Command()
	.name("dev")
	.description("Run locally your ActorCore project.")
	.addArgument(new Argument("[path]", "Location of the project"))
	.addOption(
		new Option("-p, --port [port]", "Specify which platform to use").default(
			"6420",
		),
	)
	.addOption(
		new Option("--open", "Open the browser with ActorCore Studio").default(
			true,
		),
	)
	.option("--no-open", "Do not open the browser with ActorCore Studio")
	.action(action);

export async function action(
	cmdPath = ".",
	opts: {
		port?: string;
		open?: boolean;
	} = {},
) {
	const cwd = path.join(process.cwd(), cmdPath);
	await workflow("Run locally your ActorCore project", async function* (ctx) {
		let server: ReturnType<typeof serve>;

		if (opts.open) {
			open(
				process.env._ACTOR_CORE_CLI_DEV
					? "http://localhost:43708"
					: "http://studio.actorcore.org",
			);
		}

		const watcher = chokidar.watch(cwd, {
			awaitWriteFinish: true,
			ignoreInitial: true,
			ignored: (path) => path.includes("node_modules"),
		});

		let lock: ReturnType<typeof withResolvers> = withResolvers();

		watcher.on("all", async (event, path) => {
			if (path.includes("node_modules") || path.includes("/.")) return;

			server?.close();
			if (lock) {
				lock.resolve(undefined);
				lock = withResolvers();
			}
		});

		while (true) {
			const config = yield* validateConfigTask(ctx, cwd);
			config.app.config.inspector = {
				enabled: true,
			};
			server = serve(config.app, {
				port: Number.parseInt(opts.port || "6420", 10) || 6420,
			});
			yield* ctx.task(
				"Watching for changes...",
				async () => {
					await lock.promise;
				},
				{ success: <Text dimColor> (Changes detected, restarting!)</Text> },
			);
		}
	}).render();
}
