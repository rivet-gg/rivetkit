use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

// Only called for SSE because we don't need this for WebSockets
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Init {
    // Actor ID
    pub ai: String,
    // Connection ID
    pub ci: String,
    // Connection token
    pub ct: String,
}

// Used for connection errors (both during initialization and afterwards)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Error {
    // Code
    pub c: String,
    // Message
    pub m: String,
    // Metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub md: Option<JsonValue>,
    // Action ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai: Option<i64>
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResponse {
    // ID
    pub i: i64,
    // Output
    pub o: JsonValue
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    // Event name
    pub n: String,
    // Event arguments
    pub a: Vec<JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToClientBody {
    Init { i: Init },
    Error { e: Error },
    ActionResponse { ar: ActionResponse },
    EventMessage { ev: Event },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToClient {
    // Body
    pub b: ToClientBody,
}