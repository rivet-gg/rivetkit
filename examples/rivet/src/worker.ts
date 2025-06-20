import { createWorkerHandler } from "@rivetkit/rivet/worker";
import { registry } from "./registry";

export default createWorkerHandler(registry);
