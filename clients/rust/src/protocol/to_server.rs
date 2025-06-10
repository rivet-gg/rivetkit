use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Init {
    // Conn Params
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p: Option<JsonValue>
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRequest {
    // ID
    pub i: i64,
    // Name
    pub n: String,
    // Args
    pub a: Vec<JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionRequest {
    // Event name
    pub e: String,
    // Subscribe
    pub s: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToServerBody {
    Init { i: Init },
    ActionRequest { ar: ActionRequest },
    SubscriptionRequest { sr: SubscriptionRequest },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToServer {
    pub b: ToServerBody,
}
