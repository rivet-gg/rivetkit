import * as fs from "node:fs";
import * as path from "node:path";
import { Argument, Command, Option } from "commander";
import { workflow } from "../workflow";

import { $ } from "execa";
import { Box, Text } from "ink";
import micromatch from "micromatch";
import { VERSION, getExamples } from "../macros" with { type: "macro" };
import {
	PLATFORM_NAMES,
	type Platform,
	cmd,
	resolvePlatformSpecificOptions,
} from "../utils/platforms";

const EXAMPLES = await getExamples();

export const create = new Command()
	.name("create")
	.alias("init")
	.description("Bootstrap your actor project.")
	.addArgument(new Argument("[path]", "Location of the project"))
	.addOption(
		new Option("-t, --template [template]", "Specify which template to use"),
	)
	.addOption(
		new Option(
			"-p, --platform [platform]",
			"Specify which platform to use",
		).choices(Object.keys(PLATFORM_NAMES)),
	)
	.addOption(
		new Option(
			"--actor-core-version [version]",
			"Specify version of actor-core",
		),
	)
	.addOption(new Option("--package-name [name]", "Name of the NPM package"))
	.addOption(new Option("--skip-install", "Skip installing dependencies"))
	.action(action);

export async function action(
	cmdPath: string,
	opts: {
		platform?: string;
		template?: string;
		actorCoreVersion?: string;
		packageName?: string;
		skipInstall?: boolean;
	} = {},
) {
	await workflow("Bootstrap ActorCore in your project", async function* (ctx) {
		const wd =
			cmdPath ||
			(yield* ctx.prompt("Where would you like to create your project?", {
				type: "text",
				defaultValue: "./",
				validate: (input) => {
					const parsed = path.parse(input);
					const isValidPathRegex = /^\.*?([a-zA-Z0-9_-]{0,}\/)*[a-zA-Z0-9_-]+$/;
					const isValidPath = (path: string) =>
						path === "." || path === ".." || isValidPathRegex.test(path);
					if (!isValidPath(parsed.base) || !isValidPath(parsed.name)) {
						return "Invalid path. Please use a valid directory name like 'randomName'";
					}
					return true;
				},
			}));

		const stat = fs.statSync(wd, { throwIfNoEntry: false });

		let detectedPlatform: Platform | undefined;
		if (stat?.isDirectory()) {
			detectedPlatform = yield* ctx.task("Check directory", async (ctx) => {
				const files = await fs.promises.readdir(wd);
				const nextJs = micromatch(files, ["next.config.*"]);

				if (nextJs.length > 0) {
					return "vercel" as Platform;
				}

				const deno = micromatch(files, ["deno.*", "jsr.*"]);
				if (deno.length > 0) {
					return "deno" as Platform;
				}

				const bun = micromatch(files, ["bun.*"]);
				if (bun.length > 0) {
					return "bun" as Platform;
				}

				const cloudflare = micromatch(files, ["wrangler.json"]);
				if (cloudflare.length > 0) {
					return "cloudflare-workers" as Platform;
				}

				const supabase = micromatch(files, [
					"supabase.json",
					"supabase",
					"*.toml",
				]);
				if (supabase.length > 0) {
					return "supabase" as Platform;
				}
			});
		}

		const cwd = path.join(process.cwd(), wd);

		const platform =
			(opts.platform as string) ||
			(yield* ctx.prompt(
				`To which platform would you like to deploy? ${detectedPlatform ? `(detected ${PLATFORM_NAMES[detectedPlatform]})` : ""}`,
				{
					type: "select",
					choices: Object.entries(PLATFORM_NAMES).map(([value, label]) => ({
						label,
						value,
					})),
				},
			));

		const template =
			opts.template ||
			(yield* ctx.prompt("Which template would you like to use?", {
				type: "select",
				choices: Object.values(EXAMPLES)
					.filter((example) => example.supports.includes(platform))
					.map((example) => ({
						label: example.name,
						value: example.slug,
					})),
			}));

		const platformOptions = yield* ctx.task(
			"Resolve platform specific files",
			async () => {
				return resolvePlatformSpecificOptions(platform as Platform, {
					packageName: opts.packageName,
					files: EXAMPLES[template].files,
					version: opts.actorCoreVersion || VERSION,
				});
			},
		);

		const omittedPaths: string[] = [];
		yield* ctx.task("Create files", async function* () {
			for (const [name, contents] of Object.entries(platformOptions.files)) {
				const filePath = path.join(cwd, name);

				const stat = fs.statSync(filePath, {
					throwIfNoEntry: false,
				});

				if (!stat) {
					yield fs.promises.mkdir(path.dirname(filePath), {
						recursive: true,
					});
					yield fs.promises.writeFile(filePath, contents, "utf8");
				} else {
					omittedPaths.push(filePath);
				}
			}
		});

		if (!opts.skipInstall) {
			yield* ctx.task("Install dependencies", async () => {
				await $({ cwd: wd })(...platformOptions.cmds.install);
			});
		}

		yield ctx.render(
			<>
				{omittedPaths.length > 0 && (
					<Box
						flexDirection="column"
						marginBottom={1}
						marginLeft={1}
						paddingX={4}
						paddingY={1}
						borderStyle="single"
						borderColor="yellow"
					>
						<Text color="yellow" bold>
							Warning
						</Text>
						<Text>
							We couldn't create the following files because they already exist.
						</Text>
						<Text>Remove them and re-run the command to create them.</Text>
						{omittedPaths.map((omittedPath) => (
							<Text key={omittedPath}>
								<Text>• </Text>
								{path.relative(process.cwd(), omittedPath)}
							</Text>
						))}
					</Box>
				)}
				<Box flexDirection="column" marginTop={1} marginBottom={0}>
					<Text>▸ To get started, run</Text>

					<Box flexDirection="column" marginX={2} marginY={1}>
						<Text>cd {wd}</Text>
						<Text>{cmd(platformOptions.cmds.run)} dev</Text>
					</Box>

					{platformOptions.deployable ? (
						<>
							<Text>▸ To deploy, run</Text>
							<Box flexDirection="column" marginX={2} marginY={1}>
								<Text>{cmd(platformOptions.cmds.run)} deploy</Text>
							</Box>
						</>
					) : null}

					<Text>▸ Documentation</Text>
					<Box marginX={2} marginY={1} gap={4}>
						<Box flexDirection="column">
							<Text bold>Overview</Text>
							<Text bold>React</Text>
							<Text bold>Node.js & Bun</Text>
							<Text bold>Rust</Text>
						</Box>
						<Box flexDirection="column">
							<Text underline>https://actorcore.org/overview</Text>
							<Text underline>https://actorcore.org/frameworks/react</Text>
							<Text underline>https://actorcore.org/clients/javascript</Text>
							<Text underline>https://actorcore.org/clients/rust</Text>
						</Box>
					</Box>

					<Text>▸ Star ActorCore on GitHub</Text>

					<Box flexDirection="column" marginX={2} marginY={1}>
						<Text underline>https://github.com/rivet-gg/actor-core</Text>
					</Box>
				</Box>
			</>,
		);
	}).render();
}
