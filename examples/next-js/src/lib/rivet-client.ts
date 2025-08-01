"use client";
import { createClient, createRivetKit } from "@rivetkit/next-js/client";
import type { registry } from "@/rivet/registry";

const client = createClient<typeof registry>(`${window.location.origin}/api`, {
	transport: "sse",
});
export const { useActor } = createRivetKit(client);
