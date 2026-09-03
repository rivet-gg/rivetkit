use rivetkit::Event;
use serde::{Deserialize, Serialize};

use crate::{ActorProcessId, ActorSignal, ActorTerminalId, FileBytes};

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutputEvent {
    pub process: ActorProcessId,
    pub sequence: u64,
    pub stream: agentos_client::ProcessStream,
    pub data: FileBytes,
    pub timestamp_ms: i64,
}

impl Event for ProcessOutputEvent {
    const NAME: &'static str = "process.output";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessExitEvent {
    pub process: ActorProcessId,
    pub exit_code: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<ActorSignal>,
}

impl Event for ProcessExitEvent {
    const NAME: &'static str = "process.exit";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataEvent {
    pub terminal: ActorTerminalId,
    pub sequence: u64,
    pub stream: agentos_client::ProcessStream,
    pub data: FileBytes,
    pub timestamp_ms: i64,
}

impl Event for TerminalDataEvent {
    const NAME: &'static str = "terminal.data";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStderrEvent {
    pub terminal: ActorTerminalId,
    pub sequence: u64,
    pub data: FileBytes,
    pub timestamp_ms: i64,
}

impl Event for TerminalStderrEvent {
    const NAME: &'static str = "terminal.stderr";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub terminal: ActorTerminalId,
    pub exit_code: i32,
}

impl Event for TerminalExitEvent {
    const NAME: &'static str = "terminal.exit";
}
