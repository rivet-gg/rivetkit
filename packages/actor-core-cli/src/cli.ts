import { PACKAGE_JSON } from "./macros" with { type: "macro" };
import { create, deploy, dev, endpoint, program } from "./mod";

export default program
	.name(PACKAGE_JSON.name)
	.version(PACKAGE_JSON.version)
	.description(PACKAGE_JSON.description)
	.addCommand(deploy)
	.addCommand(create)
	.addCommand(dev)
	.addCommand(endpoint)
	.parse();
