#![forbid(unsafe_code)]

mod actions;
mod config;
mod events;
mod runtime;
mod store;

use std::str::FromStr;
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use rivetkit::prelude::*;
use rivetkit::{action, Actor, Registry};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

pub use actions::{ConfigGet, RuntimeRestart, RuntimeStatusGet};
pub use config::{AgentOsActorConfig, AgentOsActorConfigInput};
pub use events::{RuntimeBooted, RuntimeLimitWarning, RuntimeShutdown};
pub use runtime::{
    CoreSidecarStatus, PackageStartupStatus, RuntimeIssue, RuntimeLifecycleState, RuntimeStatus,
};

use runtime::RuntimeController;

pub const ACTOR_NAME: &str = "agentOS";
const ACTION_CONCURRENCY_LIMIT: usize = 64;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentOsActorCreateInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<AgentOsActorConfigInput>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigApplyState {
    Applying,
    Ready,
    RestartRequired,
    Failed,
}

impl ConfigApplyState {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Applying => "applying",
            Self::Ready => "ready",
            Self::RestartRequired => "restart_required",
            Self::Failed => "failed",
        }
    }
}

impl FromStr for ConfigApplyState {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "applying" => Ok(Self::Applying),
            "ready" => Ok(Self::Ready),
            "restart_required" => Ok(Self::RestartRequired),
            "failed" => Ok(Self::Failed),
            _ => bail!("invalid actor config apply state {value:?}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    pub revision: u64,
    pub desired: AgentOsActorConfig,
    pub applied_revision: Option<u64>,
    pub status: ConfigApplyState,
    pub issues: Vec<RuntimeIssue>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOsActorState {
    pub config: ConfigSnapshot,
}

pub struct AgentOsActor {
    config: Mutex<ConfigSnapshot>,
    runtime: RuntimeController,
    action_admission: Arc<Semaphore>,
}

#[async_trait]
impl Actor for AgentOsActor {
    type State = AgentOsActorState;
    type Input = AgentOsActorCreateInput;
    type Actions = (ConfigGet, RuntimeStatusGet, RuntimeRestart);
    type Events = (RuntimeBooted, RuntimeShutdown, RuntimeLimitWarning);
    type Queue = ();
    type ConnParams = ();
    type ConnState = ();
    type Action = action::Raw;

    const HAS_DATABASE: bool = true;

    async fn create_state(_ctx: &Ctx<Self>, input: Self::Input) -> Result<Self::State> {
        let now = runtime::now_ms()?;
        let desired = AgentOsActorConfig::normalize(input.config.unwrap_or_default())
            .context("validate agentOS actor creation config")?;
        Ok(AgentOsActorState {
            config: ConfigSnapshot {
                revision: 1,
                desired,
                applied_revision: None,
                status: ConfigApplyState::Applying,
                issues: Vec::new(),
                created_at_ms: now,
                updated_at_ms: now,
            },
        })
    }

    async fn create(ctx: &Ctx<Self>) -> Result<Self> {
        let initial = ctx.state().config.clone();
        let durable = store::load_or_initialize(ctx, &initial)
            .await
            .context("initialize agentOS actor state store")?;
        ctx.set_state(AgentOsActorState {
            config: durable.clone(),
        });
        let actor = Self {
            runtime: RuntimeController::new(ctx.actor_id(), durable.revision),
            config: Mutex::new(durable.clone()),
            action_admission: Arc::new(Semaphore::new(ACTION_CONCURRENCY_LIMIT)),
        };

        // A failed Core boot does not make runtime.status unreachable. Persist
        // the failure and let the actor start in the failed lifecycle state.
        match actor.runtime.boot(&durable.desired, durable.revision).await {
            Ok(status) => actor.mark_runtime_result(ctx, &status).await?,
            Err(error) => {
                tracing::error!(?error, actor_id = %ctx.actor_id(), "agentOS runtime boot failed");
                let status = actor.runtime.status().await;
                actor.mark_runtime_result(ctx, &status).await?;
            }
        }
        Ok(actor)
    }

    async fn on_start(self: Arc<Self>, ctx: Ctx<Self>) -> Result<()> {
        let status = self.runtime.status().await;
        if status.lifecycle == RuntimeLifecycleState::Ready {
            ctx.emit(RuntimeBooted {
                generation: status.generation,
                config_revision: status.applied_config_revision.ok_or_else(|| {
                    anyhow::anyhow!("ready runtime has no applied config revision")
                })?,
                booted_at_ms: status
                    .last_boot_at_ms
                    .ok_or_else(|| anyhow::anyhow!("ready runtime has no boot timestamp"))?,
            })?;
        }
        Ok(())
    }

    async fn on_sleep(self: Arc<Self>, ctx: Ctx<Self>) -> Result<()> {
        self.shutdown(&ctx, "sleep").await
    }

    async fn on_destroy(self: Arc<Self>, ctx: Ctx<Self>) -> Result<()> {
        self.shutdown(&ctx, "destroy").await
    }
}

impl AgentOsActor {
    fn admit_action(&self) -> Result<OwnedSemaphorePermit> {
        self.action_admission
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                anyhow::anyhow!(
                    "actor action concurrency limit {ACTION_CONCURRENCY_LIMIT} reached; raise ACTION_CONCURRENCY_LIMIT"
                )
            })
    }

    async fn snapshot(&self) -> ConfigSnapshot {
        self.config.lock().await.clone()
    }

    async fn shutdown(&self, ctx: &Ctx<Self>, reason: &str) -> Result<()> {
        let before = self.runtime.status().await;
        self.runtime.stop(reason).await?;
        if before.generation > 0 {
            ctx.emit(RuntimeShutdown {
                generation: before.generation,
                reason: reason.into(),
                shutdown_at_ms: runtime::now_ms()?,
            })?;
        }
        Ok(())
    }
}

pub fn registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_actor::<AgentOsActor>(ACTOR_NAME);
    registry
}

#[cfg(test)]
mod tests {
    use rivetkit::{ActionSet, EventSet};

    use super::*;

    #[test]
    fn actor_name_and_initial_contract_are_fixed() {
        assert_eq!(ACTOR_NAME, "agentOS");
        assert_eq!(
            <<AgentOsActor as Actor>::Actions as ActionSet<AgentOsActor>>::entries()
                .into_iter()
                .map(|entry| entry.name)
                .collect::<Vec<_>>(),
            ["config.get", "runtime.status", "runtime.restart"]
        );
        assert_eq!(
            <AgentOsActor as Actor>::Events::entries()
                .into_iter()
                .map(|entry| entry.name)
                .collect::<Vec<_>>(),
            ["runtime.booted", "runtime.shutdown", "runtime.limitWarning"]
        );
    }
}
