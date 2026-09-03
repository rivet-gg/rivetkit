import { vm } from "./client.js";

const result = await vm.process.exec({
	command: "echo hello && ls /home/agentos",
	options: { env: {}, captureStdio: true },
});
console.log("stdout:", result.stdout);
console.log("stderr:", result.stderr);
console.log("exit code:", result.exitCode);
