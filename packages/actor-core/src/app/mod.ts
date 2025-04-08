import {
	type Actors,
	type AppConfig,
	type AppConfigInput,
	AppConfigSchema,
} from "./config";

export class ActorCoreApp<A extends Actors> {
	#config: AppConfig;

	public get config(): AppConfig {
		return this.#config;
	}

	constructor(config: AppConfig) {
		this.#config = config;
	}
}

export function setup<A extends Actors>(
	input: AppConfigInput<A>,
): ActorCoreApp<A> {
	const config = AppConfigSchema.parse(input);
	return new ActorCoreApp(config);
}

export type { AppConfig };
export { AppConfigSchema };
