// @ts-types="../../manager-protocol/dist/mod.d.ts"
import { ActorsRequestSchema } from "@/manager/protocol/mod";
import { Hono, type Context as HonoContext } from "hono";
import type { ManagerDriver } from "./driver";

export class Manager {
	//private readonly endpoint: string;
	//private readonly rivetClient: RivetClient;
	//private readonly environment: RivetEnvironment;

	#driver: ManagerDriver;

	router: Hono;

	public constructor(driver: ManagerDriver) {
		this.#driver = driver;

		this.router = this.#buildRouter();
	}

	//constructor(private readonly ctx: ActorContext) {
	//	const endpoint = Deno.env.get("RIVET_API_ENDPOINT");
	//	if (!endpoint) throw new Error("missing RIVET_API_ENDPOINT");
	//	const token = Deno.env.get("RIVET_SERVICE_TOKEN");
	//	if (!token) throw new Error("missing RIVET_SERVICE_TOKEN");
	//
	//	this.endpoint = endpoint;
	//
	//	this.rivetClient = new RivetClient({
	//		environment: endpoint,
	//		token,
	//	});
	//
	//	this.environment = {
	//		project: this.ctx.metadata.project.slug,
	//		environment: this.ctx.metadata.environment.slug,
	//	};
	//}
	//
	//static async start(ctx: ActorContext) {
	//	setupLogging();
	//
	//	// biome-ignore lint/complexity/noThisInStatic: Must be used for default actor entrypoint
	//	const manager = new this(ctx);
	//	await manager.#run();
	//}

	#buildRouter(): Hono {
		const managerApp = new Hono();

		//app.get("/rivet/config", (c: HonoContext) => {
		//	return c.json({
		//		// HACK(RVT-4376): Replace DNS address used for local dev envs with public address
		//		endpoint: this.endpoint.replace("rivet-server", "127.0.0.1"),
		//		project: this.environment.project,
		//		environment: this.environment.environment,
		//	} satisfies RivetConfigResponse);
		//});

		managerApp.post("/actors", async (c: HonoContext) => {
			const body = ActorsRequestSchema.parse(await c.req.json());
			const response = await this.#driver.queryActor({ body, request: c.req });
			return c.json(response);
		});

		return new Hono().route("/manager", managerApp);
	}
}
