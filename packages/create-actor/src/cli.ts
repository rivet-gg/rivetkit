import { create, createAction, program } from "@actor-core/cli";
import { PACKAGE_JSON } from "./macros" with { type: "macro" };

const createActor = program
	.name(PACKAGE_JSON.name)
	.version(PACKAGE_JSON.version)
	.description(PACKAGE_JSON.description);

for (const argument of create.registeredArguments) {
	createActor.addArgument(argument);
}

for (const command of create.commands) {
	createActor.addCommand(command);
}

for (const option of create.options) {
	createActor.addOption(option);
}

createActor.action(createAction).parse();

export default createActor;
