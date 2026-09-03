use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use agentos_client::{AgentOs, SidecarState};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::config::AgentOsActorConfig;

const INITIALIZATION_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RUNTIME_ISSUES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeLifecycleState {
    Initializing,
    Preloading,
    Booting,
    Ready,
    Degraded,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIssue {
    pub code: String,
    pub message: String,
    pub at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageStartupStatus {
    pub required_total: u32,
    pub required_ready: u32,
    pub optional_preload_total: u32,
    pub optional_preload_ready: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreSidecarStatus {
    pub state: String,
    pub active_vm_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub lifecycle: RuntimeLifecycleState,
    pub desired_config_revision: u64,
    pub applied_config_revision: Option<u64>,
    pub generation: u64,
    pub last_boot_at_ms: Option<i64>,
    pub last_shutdown_at_ms: Option<i64>,
    pub packages: PackageStartupStatus,
    pub issues: Vec<RuntimeIssue>,
    pub core: Option<CoreSidecarStatus>,
}

pub(crate) struct RuntimeController {
    actor_id: String,
    operation: Mutex<()>,
    state: Mutex<RuntimeState>,
}

struct RuntimeState {
    lifecycle: RuntimeLifecycleState,
    desired_config_revision: u64,
    applied_config_revision: Option<u64>,
    generation: u64,
    last_boot_at_ms: Option<i64>,
    last_shutdown_at_ms: Option<i64>,
    packages: PackageStartupStatus,
    issues: VecDeque<RuntimeIssue>,
    vm: Option<AgentOs>,
}

impl RuntimeController {
    pub(crate) fn new(actor_id: impl Into<String>, desired_config_revision: u64) -> Self {
        Self {
            actor_id: actor_id.into(),
            operation: Mutex::new(()),
            state: Mutex::new(RuntimeState {
                lifecycle: RuntimeLifecycleState::Initializing,
                desired_config_revision,
                applied_config_revision: None,
                generation: 0,
                last_boot_at_ms: None,
                last_shutdown_at_ms: None,
                packages: PackageStartupStatus {
                    required_total: 0,
                    required_ready: 0,
                    optional_preload_total: 0,
                    optional_preload_ready: 0,
                },
                issues: VecDeque::new(),
                vm: None,
            }),
        }
    }

    pub(crate) async fn boot(
        &self,
        desired: &AgentOsActorConfig,
        revision: u64,
    ) -> Result<RuntimeStatus> {
        let _operation = self.operation.lock().await;
        self.stop_inner("replacement").await?;
        {
            let mut state = self.state.lock().await;
            state.lifecycle = RuntimeLifecycleState::Booting;
            state.desired_config_revision = revision;
            state.generation = state
                .generation
                .checked_add(1)
                .ok_or_else(|| anyhow!("runtime generation overflow"))?;
        }

        let binary_path = std::env::current_exe()
            .context("resolve the agentOS executable for internal sidecar mode")?
            .into_os_string()
            .into_string()
            .map_err(|_| anyhow!("agentOS executable path is not valid UTF-8"))?;
        let database_path = runtime_database_path(&self.actor_id)?;
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!(
                    "create agentOS runtime state directory {}",
                    parent.display()
                )
            })?;
        }
        let config = desired.to_core_config(
            Some(binary_path),
            Some(database_path.to_string_lossy().into_owned()),
        );

        match tokio::time::timeout(INITIALIZATION_TIMEOUT, AgentOs::create(config)).await {
            Ok(Ok(vm)) => {
                let booted_at_ms = now_ms()?;
                let mut state = self.state.lock().await;
                state.lifecycle = RuntimeLifecycleState::Ready;
                state.applied_config_revision = Some(revision);
                state.last_boot_at_ms = Some(booted_at_ms);
                state.vm = Some(vm);
                Ok(snapshot(&state))
            }
            Ok(Err(error)) => {
                let mut state = self.state.lock().await;
                state.lifecycle = RuntimeLifecycleState::Failed;
                push_issue(
                    &mut state,
                    RuntimeIssue {
                        code: "runtime_boot_failed".into(),
                        message: error.to_string(),
                        at_ms: now_ms()?,
                    },
                );
                Err(anyhow!(error).context("boot agentOS Core runtime"))
            }
            Err(_) => {
                let mut state = self.state.lock().await;
                state.lifecycle = RuntimeLifecycleState::Failed;
                push_issue(
                    &mut state,
                    RuntimeIssue {
                        code: "runtime_boot_timeout".into(),
                        message: format!(
                            "runtime initialization exceeded {}ms; raise the actor initialization deadline",
                            INITIALIZATION_TIMEOUT.as_millis()
                        ),
                        at_ms: now_ms()?,
                    },
                );
                Err(anyhow!(
                    "runtime initialization exceeded {}ms",
                    INITIALIZATION_TIMEOUT.as_millis()
                ))
            }
        }
    }

    pub(crate) async fn stop(&self, reason: &str) -> Result<RuntimeStatus> {
        let _operation = self.operation.lock().await;
        self.stop_inner(reason).await?;
        Ok(self.status().await)
    }

    async fn stop_inner(&self, reason: &str) -> Result<()> {
        let vm = {
            let mut state = self.state.lock().await;
            let Some(vm) = state.vm.take() else {
                return Ok(());
            };
            state.lifecycle = RuntimeLifecycleState::Stopping;
            vm
        };

        match tokio::time::timeout(SHUTDOWN_TIMEOUT, vm.shutdown()).await {
            Ok(Ok(())) => {
                let mut state = self.state.lock().await;
                state.lifecycle = RuntimeLifecycleState::Initializing;
                state.applied_config_revision = None;
                state.last_shutdown_at_ms = Some(now_ms()?);
                tracing::info!(actor_id = %self.actor_id, %reason, "agentOS Core runtime stopped");
                Ok(())
            }
            Ok(Err(error)) => {
                let mut state = self.state.lock().await;
                state.lifecycle = RuntimeLifecycleState::Degraded;
                push_issue(
                    &mut state,
                    RuntimeIssue {
                        code: "runtime_shutdown_failed".into(),
                        message: error.to_string(),
                        at_ms: now_ms()?,
                    },
                );
                Err(anyhow!(error).context("stop agentOS Core runtime"))
            }
            Err(_) => {
                let mut state = self.state.lock().await;
                state.lifecycle = RuntimeLifecycleState::Degraded;
                push_issue(
                    &mut state,
                    RuntimeIssue {
                        code: "runtime_shutdown_timeout".into(),
                        message: format!(
                            "runtime shutdown exceeded {}ms; raise the actor shutdown deadline",
                            SHUTDOWN_TIMEOUT.as_millis()
                        ),
                        at_ms: now_ms()?,
                    },
                );
                Err(anyhow!(
                    "runtime shutdown exceeded {}ms",
                    SHUTDOWN_TIMEOUT.as_millis()
                ))
            }
        }
    }

    pub(crate) async fn status(&self) -> RuntimeStatus {
        let state = self.state.lock().await;
        snapshot(&state)
    }

    pub(crate) async fn vm(&self) -> Result<AgentOs> {
        let state = self.state.lock().await;
        if state.lifecycle != RuntimeLifecycleState::Ready {
            return Err(anyhow!(
                "runtime_not_ready: agentOS runtime is {:?}; inspect runtime.status and retry",
                state.lifecycle
            ));
        }
        state
            .vm
            .clone()
            .ok_or_else(|| anyhow!("runtime_not_ready: ready runtime has no Core VM"))
    }

    pub(crate) async fn vm_at_generation(&self, generation: u64) -> Result<AgentOs> {
        let state = self.state.lock().await;
        if state.generation != generation {
            return Err(anyhow!(
                "stale_runtime_handle: handle generation {generation} does not match current generation {}",
                state.generation
            ));
        }
        if state.lifecycle != RuntimeLifecycleState::Ready {
            return Err(anyhow!(
                "runtime_not_ready: agentOS runtime is {:?}; inspect runtime.status and retry",
                state.lifecycle
            ));
        }
        state
            .vm
            .clone()
            .ok_or_else(|| anyhow!("runtime_not_ready: ready runtime has no Core VM"))
    }
}

fn snapshot(state: &RuntimeState) -> RuntimeStatus {
    let core = state.vm.as_ref().map(|vm| {
        let description = vm.sidecar().describe();
        CoreSidecarStatus {
            state: match description.state {
                SidecarState::Ready => "ready",
                SidecarState::Disposing => "disposing",
                SidecarState::Disposed => "disposed",
            }
            .into(),
            active_vm_count: description.active_vm_count,
        }
    });
    RuntimeStatus {
        lifecycle: state.lifecycle,
        desired_config_revision: state.desired_config_revision,
        applied_config_revision: state.applied_config_revision,
        generation: state.generation,
        last_boot_at_ms: state.last_boot_at_ms,
        last_shutdown_at_ms: state.last_shutdown_at_ms,
        packages: state.packages.clone(),
        issues: state.issues.iter().cloned().collect(),
        core,
    }
}

fn push_issue(state: &mut RuntimeState, issue: RuntimeIssue) {
    if state.issues.len() == MAX_RUNTIME_ISSUES {
        state.issues.pop_front();
    }
    state.issues.push_back(issue);
}

fn runtime_database_path(actor_id: &str) -> Result<PathBuf> {
    let root = std::env::var_os("AGENTOS_ACTOR_RUNTIME_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("agentos-actor-runtime"));
    if !root.is_absolute() {
        return Err(anyhow!(
            "AGENTOS_ACTOR_RUNTIME_STATE_DIR must be an absolute path"
        ));
    }
    let digest = Sha256::digest(actor_id.as_bytes());
    Ok(root.join(format!("{}.sqlite", hex::encode(digest))))
}

pub(crate) fn now_ms() -> Result<i64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock is before the Unix epoch")?
        .as_millis();
    i64::try_from(millis).context("system clock exceeds signed millisecond range")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_database_path_does_not_embed_actor_id() {
        let path = runtime_database_path("../../other/actor").expect("runtime database path");
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("database file name");
        assert!(name.ends_with(".sqlite"));
        assert!(!name.contains(".."));
        assert!(!name.contains("actor"));
    }
}
