use rivetkit::Event;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBooted {
    pub generation: u64,
    pub config_revision: u64,
    pub booted_at_ms: i64,
}

impl Event for RuntimeBooted {
    const NAME: &'static str = "runtime.booted";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeShutdown {
    pub generation: u64,
    pub reason: String,
    pub shutdown_at_ms: i64,
}

impl Event for RuntimeShutdown {
    const NAME: &'static str = "runtime.shutdown";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLimitWarning {
    pub limit: String,
    pub observed: u64,
    pub capacity: u64,
    pub message: String,
}

impl Event for RuntimeLimitWarning {
    const NAME: &'static str = "runtime.limitWarning";
}
