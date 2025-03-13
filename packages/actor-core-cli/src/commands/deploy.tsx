import * as fs from "node:fs/promises";
import path from "node:path";
import { Argument, Command, Option } from "commander";
import dedent from "dedent";
import { $ } from "execa";
import { Box, Text } from "ink";
import semver from "semver";
import which from "which";
import { MIN_RIVET_CLI_VERSION } from "../constants";
import { VERSION } from "../macros" with { type: "macro" };
import {
	type Platform,
	resolvePlatformSpecificOptions,
	validateConfig,
} from "../utils/mod";
import { workflow } from "../workflow";
import { z } from "zod";
import { RivetClient } from "@rivet-gg/api";
import {
	createActorEndpoint,
	createRivetApi,
	getServiceToken,
} from "../utils/rivet-api";

export const deploy = new Command()
	.name("deploy")
	.description("Deploy the actor to selected platform.")
	.addArgument(
		new Argument("<platform>", "The platform to deploy to").choices(["rivet"]),
	)
	.addArgument(new Argument("[path]", "Location of the project").default("./"))
	.addOption(new Option("-v [version]", "Specify version of actor-core"))
	.addHelpText(
		"afterAll",
		"\nMissing your favorite platform?\nLet us know! https://github.com/rivet-gg/actor-core/issues/new",
	)
	.action(async (platform, wd, opts) => {
		const cwd = path.join(process.cwd(), wd);

		await workflow("Deploy actors to Rivet", async function* (ctx) {
			const { config, cli } = yield* ctx.task("Prepare", async function* (ctx) {
				const config = yield* ctx.task("Validate config", async () => {
					try {
						return await validateConfig(cwd);
					} catch (error) {
						console.error(error);
						throw ctx.error("Could not configuration file.", {
							hint: "Make sure you're running this command in the directory with actor-core.config.js file.",
						});
					}
				});

				const platformOptions = yield* ctx.task(
					"Resolve platform specific files",
					async () => {
						return resolvePlatformSpecificOptions(platform as Platform, {
							files: {},
							version: opts.version || VERSION,
						});
					},
				);

				const cli = yield* ctx.task("Locale rivet-cli", async function* (ctx) {
					let cmd = await which("rivet-cli", { nothrow: true });

					if (!cmd) {
						cmd = await which("rivet", { nothrow: true });
					}

					if (process.env.RIVET_CLI_PATH) {
						cmd = process.env.RIVET_CLI_PATH;
					}

					if (cmd) {
						// check version
						const { stdout } = yield* ctx.$`${cmd} --version`;
						const semVersion = semver.coerce(
							stdout.split("\n")[2].split(" ")[1].trim(),
						);

						if (semVersion) {
							if (semver.gte(semVersion, MIN_RIVET_CLI_VERSION)) {
								return cmd;
							}
						}
					}

					return `${platformOptions.cmds.exec} @rivet-gg/cli@latest`;
				});

				return { config, cli };
			});

			const { accessToken, projectName, envName, endpoint } = yield* ctx.task(
				"Auth to Rivet",
				async function* (ctx) {
					const isLogged = yield* ctx.task(
						"Check if logged in",
						async function* (ctx) {
							const output = yield* ctx.$`${cli} metadata auth-status`;
							return output.stdout === "true";
						},
					);

					let endpoint: string | undefined;
					if (!isLogged) {
						const isUsingCloud = yield* ctx.prompt(
							"Are you using Rivet Cloud?",
							{
								type: "confirm",
							},
						);

						endpoint = "https://api.rivet.gg";
						if (!isUsingCloud) {
							endpoint = yield* ctx.prompt("What is the API endpoint?", {
								type: "text",
								defaultValue: "http://localhost:8080",
								validate: (input) => {
									if (z.string().url().safeParse(input).success === false) {
										return "Please provide a valid URL";
									}
									return true;
								},
							});
						}

						yield* ctx.task("Login to Rivet", async function* (ctx) {
							yield* ctx.$`${cli} login --api-endpoint=${endpoint}`;
						});
					} else {
						endpoint = yield* ctx.task("Get API endpoint", async function* () {
							const { stdout } = yield* ctx.$`${cli} metadata api-endpoint`;
							return stdout;
						});
					}

					const { stdout: accessToken } =
						yield* ctx.$`${cli} metadata access-token`;

					const envName = yield* ctx.task(
						"Select environment",
						async function* () {
							const { stdout } = await $`${cli} env ls --json`;
							const envs = JSON.parse(stdout);
							return yield* ctx.prompt("Select environment", {
								type: "select",
								choices: envs.map(
									(env: { display_name: string; name_id: string }) => ({
										label: env.display_name,
										value: env.name_id,
									}),
								),
							});
						},
					);

					const projectName = yield* ctx.task(
						"Get project metadata",
						async function* (ctx) {
							const { stdout } = yield* ctx.$`${cli} metadata project-name-id`;
							return stdout;
						},
					);

					return { accessToken, projectName, envName, endpoint };
				},
			);

			const Rivet = new RivetClient({
				token: accessToken,
				environment: endpoint,
			});

			const RivetHttp = createRivetApi(endpoint, accessToken);

			const manager = yield* ctx.task(
				"Verify Actor Manager",
				async function* (ctx) {
					yield* ctx.task("Deploy Actor Manager", async function* (ctx) {
						yield fs.mkdir(path.join(cwd, ".actorcore"), {
							recursive: true,
						});

						const entrypoint = path.join(cwd, ".actorcore", "manager.js");
						yield fs.writeFile(
							entrypoint,
							dedent`
								import { createManagerHandler } from "@actor-core/rivet";
								import config from "../actor-core.config.ts";
								export default createManagerHandler(config);
							`,
						);

						const relative = path.relative(cwd, entrypoint);

						yield* ctx.task(
							`Run \`${cli} publish manager ${relative}\``,
							async function* (ctx) {
								const output =
									yield* ctx.$`${cli} publish manager --env ${envName} --access=private ${entrypoint} `;
								if (output.exitCode !== 0) {
									throw ctx.error("Failed to deploy actors.", {
										hint: "Check the logs above for more information.",
									});
								}
							},
						);
					});

					const managers = yield* ctx.task(
						"List Actor Managers",
						async (ctx) => {
							const { actors } = await Rivet.actor.list({
								tagsJson: JSON.stringify({ name: "manager" }),
								environment: envName,
								project: projectName,
								includeDestroyed: false,
							});

							return actors;
						},
					);

					if (managers.length > 1) {
						yield* ctx.warn(
							"More than 1 manager actor is running. We recommend manually stopping one of them.",
						);
					}

					if (managers.length > 0) {
						for (const manager of managers) {
							yield* ctx.task(
								`Upgrade Actor Manager ${manager.id}`,
								async (ctx) => {
									await Rivet.actor.upgrade(manager.id, {
										project: projectName,
										environment: envName,
										body: {
											buildTags: {
												name: "manager",
												current: "true",
											},
										},
									});
								},
							);
						}

						return managers[0];
					}

					return yield* ctx.task("Create Actor Manager", async (ctx) => {
						const serviceToken = await getServiceToken(RivetHttp, {
							project: projectName,
							env: envName,
						});

						const { regions } = await Rivet.actor.regions.list({
							project: projectName,
							environment: envName,
						});

						// find closest region
						const region = regions.find(
							(r) => r.id === "atl" || r.id === "local",
						);

						if (!region) {
							throw ctx.error(
								"No closest region found. Please contact support.",
							);
						}

						const { actor } = await Rivet.actor.create({
							project: projectName,
							environment: envName,
							body: {
								region: region.id,
								tags: { name: "manager", onwer: "rivet" },
								buildTags: { name: "manager", current: "true" },
								runtime: {
									environment: {
										RIVET_SERVICE_TOKEN: serviceToken,
									},
								},
								network: {
									mode: "bridge",
									ports: {
										http: {
											protocol: "https",
											routing: {
												guard: {},
											},
										},
									},
								},
								lifecycle: {
									durable: true,
								},
							},
						});

						return actor;
					});
				},
			);

			for (const [idx, actorName] of Object.keys(config.actors).entries()) {
				yield* ctx.task(
					`Deploy "${actorName}" to Rivet (${idx + 1}/${
						Object.keys(config.actors).length
					})`,
					async function* (ctx) {
						const entrypoint = yield* ctx.task(
							`Create entrypoint for ${actorName}`,
							async function* () {
								yield fs.mkdir(path.join(cwd, ".actorcore"), {
									recursive: true,
								});

								const entrypoint = path.join(
									cwd,
									".actorcore",
									`entrypoint-${actorName}.js`,
								);
								yield fs.writeFile(
									entrypoint,
									dedent`
									import { createActorHandler } from "@actor-core/rivet";
									import config from "../actor-core.config.ts";
									export default createActorHandler(config);
								`,
								);

								return entrypoint;
							},
						);

						yield* ctx.task(
							`Run \`${cli} publish ${actorName}\``,
							async function* (ctx) {
								const output =
									yield* ctx.$`${cli} publish --access=public --env ${envName} ${actorName} ${entrypoint}`;

								if (output.exitCode !== 0) {
									throw ctx.error("Failed to deploy actors.", {
										hint: "Check the logs above for more information.",
									});
								}
							},
						);

						yield* ctx.task(`Upgrade Actor ${actorName}`, async (ctx) => {
							await Rivet.actor.upgradeAll({
								project: projectName,
								environment: envName,
								body: {
									tags: { name: actorName },
									buildTags: {
										name: actorName,
										current: "true",
									},
								},
							});
						});
					},
				);
			}

			const managerEndpoint = createActorEndpoint(manager.network);
			const actorName = Object.keys(config.actors)[0];
			const hub = endpoint.includes("localhost")
				? `${endpoint}/ui`
				: "https://hub.rivet.gg";

			yield ctx.render(
				<Box marginBottom={1} flexDirection="column">
					<Box flexDirection="column" marginX={1}>
						{managerEndpoint ? (
							<>
								<Text>▸ Connect to your Actor:</Text>

								<Box flexDirection="column" marginX={2} marginY={1}>
									<Text>
										{dedent`const client = new Client("${managerEndpoint}");`}
									</Text>

									<Text>
										{dedent`const actor = await client.get({
								name: "${actorName}",
							});`}
									</Text>
								</Box>
							</>
						) : (
							<>
								<Text>▸ Connect to your Actor:</Text>

								<Box flexDirection="column" marginX={2} marginY={1}>
									<Text color="red" bold>
										Failed to deploy Actor Manager. Please check the logs in
										Rivet Hub for more information.
									</Text>
								</Box>
							</>
						)}

						<Box flexDirection="column" marginY={1}>
							<Text>▸ Log in to Rivet Hub to manage your actors</Text>
							<Box flexDirection="column" marginX={2} marginY={1}>
								<Box flexDirection="column" marginBottom={1}>
									<Text bold>Actors </Text>
									<Text
										underline
									>{`${hub}/projects/${projectName}/environments/${envName}/actors`}</Text>
								</Box>

								<Box
									flexDirection="column"
									marginBottom={managerEndpoint ? 1 : 0}
								>
									<Text bold>Builds </Text>
									<Text
										underline
									>{`${hub}/projects/${projectName}/environments/${envName}/builds`}</Text>
								</Box>

								{managerEndpoint ? (
									<Box flexDirection="column">
										<Text bold>Actor Manager </Text>
										<Text underline>{managerEndpoint}</Text>
									</Box>
								) : null}
							</Box>
						</Box>

						<Text>▸ For more information, visit</Text>
						<Box flexDirection="column" marginX={2} marginY={1}>
							<Text underline>https://actorcore.org/</Text>
						</Box>
					</Box>

					<Text>
						<Text color={"#ff4f00"}>✔</Text> Build uploaded successfully!
					</Text>
				</Box>,
			);
		}).render();
	});
