import * as path from "node:path";
import { Argument, Command, Option } from "commander";
import { workflow } from "../workflow";

import { validateConfigTask } from "../workflows/validate-config";
import chokidar from "chokidar";
import { Text } from "ink";
import open from "open";
import { withResolvers } from "../utils/mod";
import { spawn } from "node:child_process";

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
		if (opts.open) {
			open(
				process.env._ACTOR_CORE_CLI_DEV
					? "http://localhost:43708"
					: "http://studio.rivet.gg",
			);
		}

		const watcher = chokidar.watch(cwd, {
			awaitWriteFinish: true,
			ignoreInitial: true,
			ignored: (path) => path.includes("node_modules"),
		});

		function createServer() {
			return spawn(
				process.execPath,
				[
					path.join(
						path.dirname(require.resolve("@actor-core/cli")),
						"server-entry.js",
					),
				],
				{ env: { ...process.env, PORT: opts.port }, cwd },
			);
		}

		let server: ReturnType<typeof spawn> | undefined = undefined;
		let lock: ReturnType<typeof withResolvers> = withResolvers();

		function createLock() {
			if (lock) {
				lock.resolve(undefined);
			}
			lock = withResolvers();
		}

		watcher.on("all", async (_, path) => {
			if (path.includes("node_modules") || path.includes("/.")) return;

			server?.kill();
		});

		while (true) {
			yield* validateConfigTask(ctx, cwd);
			server = createServer();
			createLock();

			server?.addListener("exit", () => {
				lock.resolve(undefined);
			});

			server?.addListener("close", () => {
				lock.resolve(undefined);
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
