use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use agentos_client::{
    ExecOptions, OpenShellOptions, ProcessTreeNode, SpawnOptions, SpawnStdio, StdinInput,
};
use anyhow::{bail, Result};
use rivetkit::{Action, Ctx, Handles};
use serde::{Deserialize, Serialize};

use crate::actions::BoxFuture;
use crate::events::{
    ProcessExitEvent, ProcessOutputEvent, TerminalDataEvent, TerminalExitEvent, TerminalStderrEvent,
};
use crate::{AgentOsActor, FileBytes, FileContentInput};

const MAX_COMMAND_BYTES: usize = 16 * 1024;
const MAX_ARGUMENTS: usize = 1_024;
const MAX_ARGUMENT_BYTES: usize = 16 * 1024;
const MAX_ENVIRONMENT_ENTRIES: usize = 1_024;
const MAX_ENVIRONMENT_BYTES: usize = 256 * 1024;
const MAX_STDIN_BYTES: usize = 256 * 1024;
const MAX_EXEC_OUTPUT_BYTES: usize = 768 * 1024;
const MAX_PROCESS_LIST_ENTRIES: usize = 4_096;
const MAX_WAIT_MS: u64 = 5 * 60 * 1_000;
const DEFAULT_WAIT_MS: u64 = 30 * 1_000;
const MAX_TERMINAL_DIMENSION: u16 = 4_096;

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActorProcessId {
    pub generation: u64,
    pub pid: u32,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActorTerminalId {
    pub generation: u64,
    pub shell_id: String,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActorExecOptions {
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdin: Option<FileContentInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture_stdio: Option<bool>,
}

impl ActorExecOptions {
    fn validate(&self) -> Result<()> {
        validate_environment(&self.env)?;
        if let Some(cwd) = &self.cwd {
            validate_string("process cwd", cwd, MAX_ARGUMENT_BYTES)?;
        }
        if let Some(stdin) = &self.stdin {
            validate_bytes("process stdin", stdin.byte_len(), MAX_STDIN_BYTES)?;
        }
        if self.timeout_ms.is_some_and(|timeout| timeout > MAX_WAIT_MS) {
            bail!("limit_exceeded: process timeout exceeds {MAX_WAIT_MS}ms; lower timeoutMs");
        }
        Ok(())
    }

    fn into_core(self) -> ExecOptions {
        ExecOptions {
            env: self.env,
            cwd: self.cwd,
            stdin: self.stdin.map(file_content_to_stdin),
            timeout: self.timeout_ms.map(|value| value as f64),
            capture_stdio: self.capture_stdio,
            ..ExecOptions::default()
        }
    }
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorExecResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessExec {
    pub command: String,
    #[serde(default)]
    pub options: ActorExecOptions,
}

impl Action for ProcessExec {
    type Output = ActorExecResult;
    const NAME: &'static str = "process.exec";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessExecFile {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub options: ActorExecOptions,
}

impl Action for ProcessExecFile {
    type Output = ActorExecResult;
    const NAME: &'static str = "process.execFile";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActorSpawnOptions {
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdio: Option<SpawnStdio>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdin_fd: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdout_fd: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr_fd: Option<i32>,
}

impl ActorSpawnOptions {
    pub(crate) fn validate(&self) -> Result<()> {
        validate_environment(&self.env)?;
        if let Some(cwd) = &self.cwd {
            validate_string("process cwd", cwd, MAX_ARGUMENT_BYTES)?;
        }
        Ok(())
    }

    fn into_core(self) -> SpawnOptions {
        SpawnOptions {
            env: self.env,
            cwd: self.cwd,
            stdio: self.stdio,
            stdin_fd: self.stdin_fd,
            stdout_fd: self.stdout_fd,
            stderr_fd: self.stderr_fd,
            stream_stdin: Some(true),
            retain_output: true,
        }
    }
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessSpawn {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub options: ActorSpawnOptions,
}

impl Action for ProcessSpawn {
    type Output = ActorProcessId;
    const NAME: &'static str = "process.spawn";
}

macro_rules! process_id_action {
    ($name:ident, $output:ty, $wire_name:literal) => {
        #[cfg_attr(feature = "contract", derive(ts_rs::TS))]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name {
            pub process: ActorProcessId,
        }

        impl Action for $name {
            type Output = $output;
            const NAME: &'static str = $wire_name;
        }
    };
}

process_id_action!(ProcessGet, ActorProcessInfo, "process.get");
process_id_action!(ProcessWait, ActorProcessExit, "process.wait");
process_id_action!(ProcessCloseStdin, (), "process.closeStdin");

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorProcessInfo {
    pub process: ActorProcessId,
    pub command: String,
    pub args: Vec<String>,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub started_at: i64,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorProcessExit {
    pub process: ActorProcessId,
    pub exit_code: i32,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessList;

impl Action for ProcessList {
    type Output = Vec<ActorProcessInfo>;
    const NAME: &'static str = "process.list";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessTree;

impl Action for ProcessTree {
    type Output = ActorProcessTree;
    const NAME: &'static str = "process.tree";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorProcessTree {
    pub generation: u64,
    pub roots: Vec<ProcessTreeNode>,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActorSignal {
    #[serde(rename = "SIGTERM")]
    Term,
    #[serde(rename = "SIGINT")]
    Interrupt,
    #[serde(rename = "SIGKILL")]
    Kill,
}

impl ActorSignal {
    fn as_str(self) -> &'static str {
        match self {
            Self::Term => "SIGTERM",
            Self::Interrupt => "SIGINT",
            Self::Kill => "SIGKILL",
        }
    }
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessSignal {
    pub process: ActorProcessId,
    pub signal: ActorSignal,
}

impl Action for ProcessSignal {
    type Output = ();
    const NAME: &'static str = "process.signal";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessWriteStdin {
    pub process: ActorProcessId,
    pub data: FileContentInput,
}

impl Action for ProcessWriteStdin {
    type Output = ();
    const NAME: &'static str = "process.writeStdin";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessResizePty {
    pub process: ActorProcessId,
    pub cols: u16,
    pub rows: u16,
}

impl Action for ProcessResizePty {
    type Output = ();
    const NAME: &'static str = "process.resizePty";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessReadOutput {
    pub process: ActorProcessId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_events: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
}

impl Action for ProcessReadOutput {
    type Output = ActorProcessOutputReplay;
    const NAME: &'static str = "process.readOutput";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorProcessOutputReplay {
    pub process: ActorProcessId,
    pub events: Vec<ActorProcessOutputEvent>,
    pub next_cursor: Option<u64>,
    pub has_more: bool,
    pub truncated: bool,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorProcessOutputEvent {
    pub sequence: u64,
    pub stream: agentos_client::ProcessStream,
    pub data: FileBytes,
    pub timestamp_ms: i64,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActorTerminalOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u16>,
}

impl ActorTerminalOptions {
    fn validate(&self) -> Result<()> {
        if let Some(command) = &self.command {
            validate_command(command)?;
        }
        validate_arguments(&self.args)?;
        validate_environment(&self.env)?;
        validate_dimensions(self.cols, self.rows)?;
        Ok(())
    }

    fn into_core(self) -> OpenShellOptions {
        OpenShellOptions {
            command: self.command,
            args: self.args,
            env: self.env,
            cwd: self.cwd,
            cols: self.cols,
            rows: self.rows,
        }
    }
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalOpen {
    #[serde(default)]
    pub options: ActorTerminalOptions,
}

impl Action for TerminalOpen {
    type Output = ActorTerminalId;
    const NAME: &'static str = "terminal.open";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalList;

impl Action for TerminalList {
    type Output = Vec<ActorTerminalInfo>;
    const NAME: &'static str = "terminal.list";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorTerminalInfo {
    pub terminal: ActorTerminalId,
    pub pid: u32,
    pub running: bool,
    pub exit_code: Option<i32>,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalSnapshot {
    pub terminal: ActorTerminalId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
}

impl Action for TerminalSnapshot {
    type Output = ActorTerminalSnapshot;
    const NAME: &'static str = "terminal.snapshot";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorTerminalSnapshot {
    pub terminal: ActorTerminalId,
    pub pid: u32,
    pub events: Vec<ActorTerminalOutputEvent>,
    pub next_cursor: Option<u64>,
    pub has_more: bool,
    pub truncated: bool,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorTerminalOutputEvent {
    pub sequence: u64,
    pub stream: agentos_client::ProcessStream,
    pub data: FileBytes,
    pub timestamp_ms: i64,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalWrite {
    pub terminal: ActorTerminalId,
    pub data: FileContentInput,
}

impl Action for TerminalWrite {
    type Output = ();
    const NAME: &'static str = "terminal.write";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalResize {
    pub terminal: ActorTerminalId,
    pub cols: u16,
    pub rows: u16,
}

impl Action for TerminalResize {
    type Output = ();
    const NAME: &'static str = "terminal.resize";
}

macro_rules! terminal_id_action {
    ($name:ident, $output:ty, $wire_name:literal) => {
        #[cfg_attr(feature = "contract", derive(ts_rs::TS))]
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name {
            pub terminal: ActorTerminalId,
        }

        impl Action for $name {
            type Output = $output;
            const NAME: &'static str = $wire_name;
        }
    };
}

terminal_id_action!(TerminalWait, ActorTerminalExit, "terminal.wait");
terminal_id_action!(TerminalClose, (), "terminal.close");

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorTerminalExit {
    pub terminal: ActorTerminalId,
    pub exit_code: i32,
}

impl Handles<ProcessExec> for AgentOsActor {
    type Future = BoxFuture<ActorExecResult>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessExec) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_command(&action.command)?;
            action.options.validate()?;
            let result = self
                .runtime
                .vm()
                .await?
                .exec_process(&action.command, action.options.into_core())
                .await?;
            actor_exec_result(result)
        })
    }
}

impl Handles<ProcessExecFile> for AgentOsActor {
    type Future = BoxFuture<ActorExecResult>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessExecFile) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_command(&action.command)?;
            validate_arguments(&action.args)?;
            action.options.validate()?;
            let result = self
                .runtime
                .vm()
                .await?
                .exec_argv_process(&action.command, &action.args, action.options.into_core())
                .await?;
            actor_exec_result(result)
        })
    }
}

impl Handles<ProcessSpawn> for AgentOsActor {
    type Future = BoxFuture<ActorProcessId>;
    fn handle(self: Arc<Self>, ctx: Ctx<Self>, action: ProcessSpawn) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_command(&action.command)?;
            validate_arguments(&action.args)?;
            action.options.validate()?;
            let status = self.runtime.status().await;
            let vm = self.runtime.vm_at_generation(status.generation).await?;
            let handle =
                vm.spawn_process(&action.command, action.args, action.options.into_core())?;
            let process = ActorProcessId {
                generation: status.generation,
                pid: handle.pid,
            };
            attach_process_events(&vm, ctx, process)?;
            Ok(process)
        })
    }
}

impl Handles<ProcessGet> for AgentOsActor {
    type Future = BoxFuture<ActorProcessInfo>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessGet) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let info = self
                .runtime
                .vm_at_generation(action.process.generation)
                .await?
                .get_process(action.process.pid)?;
            Ok(actor_process_info(action.process.generation, info))
        })
    }
}

impl Handles<ProcessList> for AgentOsActor {
    type Future = BoxFuture<Vec<ActorProcessInfo>>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, _action: ProcessList) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let status = self.runtime.status().await;
            let entries = self
                .runtime
                .vm_at_generation(status.generation)
                .await?
                .list_processes();
            validate_count(
                "process.list result",
                entries.len(),
                MAX_PROCESS_LIST_ENTRIES,
            )?;
            Ok(entries
                .into_iter()
                .map(|info| actor_process_info(status.generation, info))
                .collect())
        })
    }
}

impl Handles<ProcessTree> for AgentOsActor {
    type Future = BoxFuture<ActorProcessTree>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, _action: ProcessTree) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let status = self.runtime.status().await;
            let roots = self
                .runtime
                .vm_at_generation(status.generation)
                .await?
                .process_tree()
                .await?;
            validate_count(
                "process.tree result",
                count_process_tree_nodes(&roots),
                MAX_PROCESS_LIST_ENTRIES,
            )?;
            Ok(ActorProcessTree {
                generation: status.generation,
                roots,
            })
        })
    }
}

impl Handles<ProcessWait> for AgentOsActor {
    type Future = BoxFuture<ActorProcessExit>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessWait) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let vm = self
                .runtime
                .vm_at_generation(action.process.generation)
                .await?;
            let exit_code = tokio::time::timeout(
                Duration::from_millis(DEFAULT_WAIT_MS),
                vm.wait_process(action.process.pid),
            )
            .await
            .map_err(|_| {
                anyhow::anyhow!(
                    "timeout: process.wait exceeded {DEFAULT_WAIT_MS}ms; call again to continue waiting"
                )
            })??;
            Ok(ActorProcessExit {
                process: action.process,
                exit_code,
            })
        })
    }
}

impl Handles<ProcessSignal> for AgentOsActor {
    type Future = BoxFuture<()>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessSignal) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            self.runtime
                .vm_at_generation(action.process.generation)
                .await?
                .signal_process_awaited(action.process.pid, action.signal.as_str())
                .await?;
            Ok(())
        })
    }
}

impl Handles<ProcessWriteStdin> for AgentOsActor {
    type Future = BoxFuture<()>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessWriteStdin) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_bytes("process stdin", action.data.byte_len(), MAX_STDIN_BYTES)?;
            self.runtime
                .vm_at_generation(action.process.generation)
                .await?
                .write_process_stdin_awaited(action.process.pid, file_content_to_stdin(action.data))
                .await?;
            Ok(())
        })
    }
}

impl Handles<ProcessCloseStdin> for AgentOsActor {
    type Future = BoxFuture<()>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessCloseStdin) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            self.runtime
                .vm_at_generation(action.process.generation)
                .await?
                .close_process_stdin_awaited(action.process.pid)
                .await?;
            Ok(())
        })
    }
}

impl Handles<ProcessResizePty> for AgentOsActor {
    type Future = BoxFuture<()>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessResizePty) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_dimensions(Some(action.cols), Some(action.rows))?;
            self.runtime
                .vm_at_generation(action.process.generation)
                .await?
                .resize_process_pty_awaited(action.process.pid, action.cols, action.rows)
                .await?;
            Ok(())
        })
    }
}

impl Handles<ProcessReadOutput> for AgentOsActor {
    type Future = BoxFuture<ActorProcessOutputReplay>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: ProcessReadOutput) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let replay = self
                .runtime
                .vm_at_generation(action.process.generation)
                .await?
                .read_process_output(
                    action.process.pid,
                    action.after,
                    action.max_events,
                    action.max_bytes,
                )?;
            Ok(ActorProcessOutputReplay {
                process: action.process,
                events: replay
                    .events
                    .into_iter()
                    .map(|event| ActorProcessOutputEvent {
                        sequence: event.sequence,
                        stream: event.stream,
                        data: FileBytes(event.data),
                        timestamp_ms: event.timestamp_ms,
                    })
                    .collect(),
                next_cursor: replay.next_cursor,
                has_more: replay.has_more,
                truncated: replay.truncated,
            })
        })
    }
}

impl Handles<TerminalOpen> for AgentOsActor {
    type Future = BoxFuture<ActorTerminalId>;
    fn handle(self: Arc<Self>, ctx: Ctx<Self>, action: TerminalOpen) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            action.options.validate()?;
            let status = self.runtime.status().await;
            let vm = self.runtime.vm_at_generation(status.generation).await?;
            let handle = vm.open_shell(action.options.into_core())?;
            let terminal = ActorTerminalId {
                generation: status.generation,
                shell_id: handle.shell_id,
            };
            let output_ctx = ctx.clone();
            let output_terminal = terminal.clone();
            vm.on_shell_output(&terminal.shell_id, move |event| {
                if let Err(error) = output_ctx.emit(TerminalDataEvent {
                    terminal: output_terminal.clone(),
                    sequence: event.sequence,
                    stream: event.stream.clone(),
                    data: FileBytes(event.data.clone()),
                    timestamp_ms: event.timestamp_ms,
                }) {
                    tracing::warn!(?error, shell_id = %output_terminal.shell_id, "emit terminal.data failed");
                }
                if event.stream == agentos_client::ProcessStream::Stderr {
                    if let Err(error) = output_ctx.emit(TerminalStderrEvent {
                        terminal: output_terminal.clone(),
                        sequence: event.sequence,
                        data: FileBytes(event.data),
                        timestamp_ms: event.timestamp_ms,
                    }) {
                        tracing::warn!(?error, shell_id = %output_terminal.shell_id, "emit terminal.stderr failed");
                    }
                }
            })?
            .detach();
            let exit_ctx = ctx;
            let exit_terminal = terminal.clone();
            vm.on_shell_exit(&terminal.shell_id, move |event| {
                if let Err(error) = exit_ctx.emit(TerminalExitEvent {
                    terminal: exit_terminal.clone(),
                    exit_code: event.exit_code,
                }) {
                    tracing::warn!(?error, shell_id = %exit_terminal.shell_id, "emit terminal.exit failed");
                }
            })?
            .detach();
            Ok(terminal)
        })
    }
}

impl Handles<TerminalList> for AgentOsActor {
    type Future = BoxFuture<Vec<ActorTerminalInfo>>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, _action: TerminalList) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let status = self.runtime.status().await;
            let terminals = self
                .runtime
                .vm_at_generation(status.generation)
                .await?
                .list_shells();
            validate_count(
                "terminal.list result",
                terminals.len(),
                MAX_PROCESS_LIST_ENTRIES,
            )?;
            Ok(terminals
                .into_iter()
                .map(|info| ActorTerminalInfo {
                    terminal: ActorTerminalId {
                        generation: status.generation,
                        shell_id: info.shell_id,
                    },
                    pid: info.pid,
                    running: info.running,
                    exit_code: info.exit_code,
                })
                .collect())
        })
    }
}

impl Handles<TerminalSnapshot> for AgentOsActor {
    type Future = BoxFuture<ActorTerminalSnapshot>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: TerminalSnapshot) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let snapshot = self
                .runtime
                .vm_at_generation(action.terminal.generation)
                .await?
                .snapshot_shell(&action.terminal.shell_id, action.after, action.max_bytes)?;
            Ok(ActorTerminalSnapshot {
                terminal: action.terminal,
                pid: snapshot.pid,
                events: snapshot
                    .events
                    .into_iter()
                    .map(|event| ActorTerminalOutputEvent {
                        sequence: event.sequence,
                        stream: event.stream,
                        data: FileBytes(event.data),
                        timestamp_ms: event.timestamp_ms,
                    })
                    .collect(),
                next_cursor: snapshot.next_cursor,
                has_more: snapshot.has_more,
                truncated: snapshot.truncated,
            })
        })
    }
}

impl Handles<TerminalWrite> for AgentOsActor {
    type Future = BoxFuture<()>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: TerminalWrite) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_bytes("terminal write", action.data.byte_len(), MAX_STDIN_BYTES)?;
            self.runtime
                .vm_at_generation(action.terminal.generation)
                .await?
                .write_shell_awaited(
                    &action.terminal.shell_id,
                    file_content_to_stdin(action.data),
                )
                .await?;
            Ok(())
        })
    }
}

impl Handles<TerminalResize> for AgentOsActor {
    type Future = BoxFuture<()>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: TerminalResize) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_dimensions(Some(action.cols), Some(action.rows))?;
            self.runtime
                .vm_at_generation(action.terminal.generation)
                .await?
                .resize_shell_awaited(&action.terminal.shell_id, action.cols, action.rows)
                .await?;
            Ok(())
        })
    }
}

impl Handles<TerminalWait> for AgentOsActor {
    type Future = BoxFuture<ActorTerminalExit>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: TerminalWait) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let vm = self
                .runtime
                .vm_at_generation(action.terminal.generation)
                .await?;
            let exit_code = tokio::time::timeout(
                Duration::from_millis(DEFAULT_WAIT_MS),
                vm.wait_shell(&action.terminal.shell_id),
            )
            .await
            .map_err(|_| {
                anyhow::anyhow!(
                    "timeout: terminal.wait exceeded {DEFAULT_WAIT_MS}ms; call again to continue waiting"
                )
            })??;
            Ok(ActorTerminalExit {
                terminal: action.terminal,
                exit_code,
            })
        })
    }
}

impl Handles<TerminalClose> for AgentOsActor {
    type Future = BoxFuture<()>;
    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: TerminalClose) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            self.runtime
                .vm_at_generation(action.terminal.generation)
                .await?
                .close_shell_awaited(&action.terminal.shell_id)
                .await?;
            Ok(())
        })
    }
}

fn actor_exec_result(result: agentos_client::ExecResult) -> Result<ActorExecResult> {
    validate_bytes(
        "process exec output",
        result.stdout.len().saturating_add(result.stderr.len()),
        MAX_EXEC_OUTPUT_BYTES,
    )?;
    Ok(ActorExecResult {
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
    })
}

fn actor_process_info(
    generation: u64,
    info: agentos_client::SpawnedProcessInfo,
) -> ActorProcessInfo {
    ActorProcessInfo {
        process: ActorProcessId {
            generation,
            pid: info.pid,
        },
        command: info.command,
        args: info.args,
        running: info.running,
        exit_code: info.exit_code,
        started_at: info.started_at,
    }
}

pub(crate) fn attach_process_events(
    vm: &agentos_client::AgentOs,
    ctx: Ctx<AgentOsActor>,
    process: ActorProcessId,
) -> Result<()> {
    let output_ctx = ctx.clone();
    let output_process = process;
    vm.on_process_output(process.pid, move |event| {
        let (Some(sequence), Some(timestamp_ms)) = (event.sequence, event.timestamp_ms) else {
            tracing::warn!(
                pid = event.pid,
                "retained process output lacked sequence metadata"
            );
            return;
        };
        if let Err(error) = output_ctx.emit(ProcessOutputEvent {
            process: output_process,
            sequence,
            stream: event.stream,
            data: FileBytes(event.data),
            timestamp_ms,
        }) {
            tracing::warn!(?error, pid = event.pid, "emit process.output failed");
        }
    })?
    .detach();
    vm.on_process_exit(process.pid, move |event| {
        if let Err(error) = ctx.emit(ProcessExitEvent {
            process,
            exit_code: event.exit_code,
            signal: None,
        }) {
            tracing::warn!(?error, pid = event.pid, "emit process.exit failed");
        }
    })?
    .detach();
    Ok(())
}

fn file_content_to_stdin(content: FileContentInput) -> StdinInput {
    match content {
        FileContentInput::Text(value) => StdinInput::Text(value),
        FileContentInput::Bytes(value) => StdinInput::Bytes(value),
    }
}

pub(crate) fn validate_command(command: &str) -> Result<()> {
    validate_string("process command", command, MAX_COMMAND_BYTES)
}

pub(crate) fn validate_arguments(args: &[String]) -> Result<()> {
    validate_count("process argument count", args.len(), MAX_ARGUMENTS)?;
    for arg in args {
        validate_string("process argument", arg, MAX_ARGUMENT_BYTES)?;
    }
    Ok(())
}

fn validate_environment(env: &BTreeMap<String, String>) -> Result<()> {
    validate_count(
        "process environment entries",
        env.len(),
        MAX_ENVIRONMENT_ENTRIES,
    )?;
    let bytes = env.iter().try_fold(0usize, |total, (key, value)| {
        total
            .checked_add(key.len())
            .and_then(|sum| sum.checked_add(value.len()))
            .ok_or_else(|| anyhow::anyhow!("limit_exceeded: environment byte count overflow"))
    })?;
    validate_bytes("process environment", bytes, MAX_ENVIRONMENT_BYTES)
}

fn validate_dimensions(cols: Option<u16>, rows: Option<u16>) -> Result<()> {
    for (name, value) in [("cols", cols), ("rows", rows)] {
        if value.is_some_and(|value| value == 0 || value > MAX_TERMINAL_DIMENSION) {
            bail!("limit_exceeded: terminal {name} must be between 1 and {MAX_TERMINAL_DIMENSION}");
        }
    }
    Ok(())
}

fn count_process_tree_nodes(roots: &[ProcessTreeNode]) -> usize {
    let mut count = 0usize;
    let mut pending = roots.iter().collect::<Vec<_>>();
    while let Some(node) = pending.pop() {
        count = count.saturating_add(1);
        pending.extend(node.children.iter());
    }
    count
}

fn validate_string(label: &str, value: &str, limit: usize) -> Result<()> {
    if value.is_empty() || value.len() > limit {
        bail!("limit_exceeded: {label} must contain 1..={limit} bytes");
    }
    Ok(())
}

fn validate_count(label: &str, actual: usize, limit: usize) -> Result<()> {
    if actual > limit {
        bail!("limit_exceeded: {label} is {actual}, limit is {limit}");
    }
    Ok(())
}

fn validate_bytes(label: &str, actual: usize, limit: usize) -> Result<()> {
    if actual > limit {
        bail!("limit_exceeded: {label} is {actual} bytes, limit is {limit}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_handles_are_runtime_scoped() {
        let process = ActorProcessId {
            generation: 4,
            pid: 100,
        };
        let encoded = serde_json::to_value(process).expect("encode handle");
        assert_eq!(encoded["generation"], 4);
        assert_eq!(encoded["pid"], 100);
    }

    #[test]
    fn command_and_terminal_limits_are_bounded() {
        assert!(validate_command("sh").is_ok());
        assert!(validate_command("").is_err());
        assert!(validate_dimensions(Some(80), Some(24)).is_ok());
        assert!(validate_dimensions(Some(0), Some(24)).is_err());
    }
}
