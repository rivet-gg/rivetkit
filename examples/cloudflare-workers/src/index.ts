import { createHandler } from "@rivetkit/cloudflare-workers";
import { registry } from "./registry";

const { handler, WorkerHandler } = createHandler(registry);

export { handler as default, WorkerHandler };
