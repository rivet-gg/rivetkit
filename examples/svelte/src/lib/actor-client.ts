import { createClient, createRivetKit } from "@rivetkit/svelte";
import type { Registry } from "../../backend";

const client = createClient<Registry>(`http://localhost:8080`);
export const { useActor } = createRivetKit(client);
