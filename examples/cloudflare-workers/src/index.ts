import { createServerHandler } from "@rivetkit/cloudflare-workers";
import { registry } from "./registry";

const { handler, ActorHandler } = createServerHandler(registry);
export { handler as default, ActorHandler };
