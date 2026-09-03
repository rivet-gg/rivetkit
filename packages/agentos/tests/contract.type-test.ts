import type {
	AgentOsActorCreateInput,
	AgentOsActorHandle,
	ConfigSetOutput,
	NetworkFetchStreamStartOutput,
	RuntimeStatusOutput,
	SoftwareInstallInput,
} from "../src/index";

declare const actor: AgentOsActorHandle;

const createInput: AgentOsActorCreateInput = {
	config: {
		environment: { CI: "true" },
		preview: { defaultTtlMs: 30_000 },
		filesystem: {},
		software: [{ url: "https://packages.example/tool.aospkg" }],
	},
};
void createInput;

const status: Promise<RuntimeStatusOutput> = actor.runtime.status();
const config: Promise<ConfigSetOutput> = actor.config.set({ config: {} });
const stream: Promise<NetworkFetchStreamStartOutput> =
	actor.network.fetchStream.start({
		request: {
			port: 3000,
			path: "/health",
			method: "GET",
			headers: {},
		},
	});
void status;
void config;
void stream;

const remoteSoftware: SoftwareInstallInput = {
	source: { url: "https://packages.example/tool.aospkg" },
};
void remoteSoftware;

const filesystemDefaults: AgentOsActorCreateInput = {
	config: {
		filesystem: {
			root: { type: "actor-sqlite" },
			mounts: [
				{
					path: "/data",
					backend: { type: "actor-sqlite" },
				},
			],
		},
	},
};
void filesystemDefaults;

// @ts-expect-error hosted software cannot read a host path
const hostSoftware: SoftwareInstallInput = { source: { path: "/tmp/tool.aospkg" } };
void hostSoftware;

// @ts-expect-error agents and sessions are absent from the hosted actor contract
actor.sessions.create({});

// @ts-expect-error reserved maintenance actions are not public client methods
actor.__agentos.cron.invoke({});
