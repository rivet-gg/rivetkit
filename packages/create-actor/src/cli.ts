import { create, program } from "@actor-core/cli";
import { PACKAGE_JSON } from "./macros" with { type: "macro" };

export default program
	.name(PACKAGE_JSON.name)
	.version(PACKAGE_JSON.version)
	.description(PACKAGE_JSON.description)
	.addCommand(create, { isDefault: true })
	.parse();
