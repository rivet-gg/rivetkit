use serde::{Deserialize, Serialize};
use serde_json::Value;

// Client-bound messages (ToClient)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Init {
    // Connection id
    pub ci: String,
    // Connection token
    pub ct: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponseOk {
    // Request id
    pub i: i64,
    // Output value
    pub o: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponseError {
    // Request id
    pub i: i64,
    // Error code
    pub c: String,
    // Error message
    pub m: String,
    // Error metadata
    pub md: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToClientEvent {
    // Event name
    pub n: String,
    // Event arguments
    pub a: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToClientError {
    // Error code
    pub c: String,
    // Error message
    pub m: String,
    // Error metadata
    pub md: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToClientBody {
    // Initialize connection
    Init { i: Init },
    // RPC response success
    ResponseOk { ro: RpcResponseOk },
    // RPC response error
    ResponseError { re: RpcResponseError },
    // Event message
    EventMessage { ev: ToClientEvent },
    // Error message
    EventError { er: ToClientError },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToClient {
    // Message body
    pub b: ToClientBody,
}

// Server-bound messages (ToServer)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    // Request id
    pub i: i64,
    // Method name
    pub n: String,
    // Method arguments
    pub a: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionRequest {
    // Event name
    pub e: String,
    // Subscribe (true) or unsubscribe (false)
    pub s: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToServerBody {
    // RPC request
    RpcRequest { rr: RpcRequest },
    // Subscription request
    SubscriptionRequest { sr: SubscriptionRequest },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToServer {
    // Message body
    pub b: ToServerBody,
}
