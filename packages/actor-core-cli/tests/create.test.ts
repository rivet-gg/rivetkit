import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { assert, beforeAll, describe, expect, it, test } from "vitest";

const PLATFORMS = ["rivet", "nodejs", "bun", "cloudflare-workers"];
const EXAMPLES = ["chat-room", "counter"];

let container: StartedTestContainer;
beforeAll(async () => {
	container = await new GenericContainer("node:lts-alpine")
		.withDefaultLogDriver()
		.withCommand(["sleep", "infinity"])
		.withReuse()
		.withNetworkMode("host")
		.start();

	await container.exec([
		"npm",
		"config",
		"set",
		"-g",
		"registry",
		"http://localhost:4873",
	]);

	return async () => {
		await container.stop();
	};
}, 30e4);

const testCases = PLATFORMS.flatMap((platform) =>
	EXAMPLES.map((example) => [example, platform]),
);
// TODO: These tests time out
describe.skip("npx create-actor", () => {
	describe.each(testCases)(
		"should create example '%s' for '%s'",
		async (example, platform) => {
			const workingDir = `/app/test-${example}-${platform}`;
			test("it should create directory with files matching the example", async () => {
				const result = await container.exec([
					"npx",
					"@actor-core/cli",
					"create",
					workingDir,
					"--platform",
					platform,
					"--template",
					example,
				]);

				expect(result.exitCode).toBe(0);

				const { stdout: files } = await container.exec([
					"find",
					workingDir,
					"-not",
					"-path",
					"*/node_modules/*",
				]);

				expect(files.split("\n").toSorted()).toMatchSnapshot();
			});

			it("it should allow user to run check-types script without errors", async () => {
				const result = await container.exec(["npm", "run", "check-types"], {
					workingDir,
				});

				assert.equal(result.exitCode, 0, result.stdout);
			});
		},
		10e4,
	);
});
