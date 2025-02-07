export const DEFAULT_ROUTER_MAX_CONNECTION_PARAMETER_SIZE = 8_192;
export const DEFAULT_ROUTER_MAX_INCOMING_MESSAGE_SIZE = 65_536;

/** Base config used for the actor config across all platforms. */
export interface BaseConfig {
	router?: {
		/** This goes in the URL so it needs to be short. */
		maxConnectionParametersSize?: number;

		maxIncomingMessageSize?: number;
	};
}
