import * as fs from "node:fs/promises";
import path from "node:path";
import { Argument, Command, Option } from "commander";
import { $ } from "execa";
import semver from "semver";
import which from "which";
import { MIN_RIVET_CLI_VERSION } from "../constants";
import { workflow } from "../workflow";
import { RivetClient } from "@rivet-gg/api";
import {
	createActorEndpoint,
	createRivetApi,
	getServiceToken,
} from "../utils/rivet-api";
import { validateConfigTask } from "../workflows/validate-config";
import invariant from "invariant";

export const endpoint = new Command()
	.name("endpoint")
	.description(
		"Get the application endpoint URL for your deployed application in Rivet.",
	)
	.addArgument(
		new Argument("<platform>", "The platform to get the endpoint for").choices([
			"rivet",
		]),
	)
	.addOption(
		new Option(
			"-e, --env [env]",
			"Specify environment to get the endpoint for",
		),
	)
	.addOption(
		new Option("--plain", "Output only the URL without any additional text"),
	)
	// No actor option needed - returns the first available endpoint
	.action(
		async (
			platform,
			opts: {
				env?: string;
				plain?: boolean;
			},
		) => {
			const cwd = process.cwd();

			const exec = $({
				cwd,
				env: { ...process.env, npm_config_yes: "true" },
			});

			await workflow(
				"Get actor endpoint",
				async function*(ctx) {
					const cli = yield* ctx.task("Locate rivet-cli", async (ctx) => {
						let cliLocation = process.env.RIVET_CLI_PATH || null;

						if (!cliLocation) {
							cliLocation = await which("rivet-cli", { nothrow: true });
						}

						if (!cliLocation) {
							cliLocation = await which("rivet", { nothrow: true });
						}

						if (cliLocation) {
							// check version
							const { stdout } = await exec`${cliLocation} --version`;
							const semVersion = semver.coerce(
								stdout.split("\n")[2].split(" ")[1].trim(),
							);

							if (semVersion) {
								if (semver.gte(semVersion, MIN_RIVET_CLI_VERSION)) {
									return cliLocation;
								}
							}
						}

						return ["npx", "@rivet-gg/cli@latest"];
					});

					const { accessToken, projectName, envName, endpoint } =
						yield* ctx.task("Auth with Rivet", async function*(ctx) {
							const { stdout } = await exec`${cli} metadata auth-status`;
							const isLogged = stdout === "true";

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
									});
								}

								await exec`${cli} login --api-endpoint=${endpoint}`;
							} else {
								const { stdout } = await exec`${cli} metadata api-endpoint`;
								endpoint = stdout;
							}

							const { stdout: accessToken } =
								await exec`${cli} metadata access-token`;

							const { stdout: rawEnvs } = await exec`${cli} env ls --json`;
							const envs = JSON.parse(rawEnvs);

							const envName =
								opts.env ??
								(yield* ctx.prompt("Select environment", {
									type: "select",
									choices: envs.map(
										(env: { display_name: string; name_id: string }) => ({
											label: env.display_name,
											value: env.name_id,
										}),
									),
								}));

							const { stdout: projectName } =
								await exec`${cli} metadata project-name-id`;

							return { accessToken, projectName, envName, endpoint };
						});

					const rivet = new RivetClient({
						token: accessToken,
						environment: endpoint,
					});

					yield* ctx.task("Get actor endpoint", async function*(ctx) {
						const { actors } = await rivet.actor.list({
							environment: envName,
							project: projectName,
							includeDestroyed: false,
							tagsJson: JSON.stringify({
								name: "manager",
								role: "manager",
								framework: "actor-core",
							}),
						});

						if (actors.length === 0) {
							throw ctx.error("No managers found for this project.", {
								hint: "Make sure you have deployed first.",
							});
						}

						const managerActor = actors[0];
						const port = managerActor.network.ports.http;
						invariant(port, "http port does not exist on manager");
						invariant(port.url, "port has no url");

						if (opts.plain) {
							console.log(port.url);
						} else {
							yield ctx.log(`Application endpoint: ${port.url}`);
						}
					});
				},
				{
					showLabel: !opts.plain,
					quiet: opts.plain,
				},
			).render();
		},
	);
