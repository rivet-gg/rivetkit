use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use anyhow::{Context, Result};
use rivetkit::{Action, Ctx, Handles};
use serde::{Deserialize, Serialize};

use crate::events::{RuntimeBooted, RuntimeShutdown};
use crate::runtime::RuntimeStatus;
use crate::{store, AgentOsActor, ConfigSnapshot};

pub(crate) type BoxFuture<T> = Pin<Box<dyn Future<Output = Result<T>> + Send>>;

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigGet;

impl Action for ConfigGet {
    type Output = ConfigSnapshot;

    const NAME: &'static str = "config.get";
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RuntimeStatusGet;

impl Action for RuntimeStatusGet {
    type Output = RuntimeStatus;

    const NAME: &'static str = "runtime.status";
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RuntimeRestart;

impl Action for RuntimeRestart {
    type Output = RuntimeStatus;

    const NAME: &'static str = "runtime.restart";
}

impl Handles<ConfigGet> for AgentOsActor {
    type Future = BoxFuture<ConfigSnapshot>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, _action: ConfigGet) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            Ok(self.snapshot().await)
        })
    }
}

impl Handles<RuntimeStatusGet> for AgentOsActor {
    type Future = BoxFuture<RuntimeStatus>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, _action: RuntimeStatusGet) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            Ok(self.runtime.status().await)
        })
    }
}

impl Handles<RuntimeRestart> for AgentOsActor {
    type Future = BoxFuture<RuntimeStatus>;

    fn handle(self: Arc<Self>, ctx: Ctx<Self>, _action: RuntimeRestart) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let _mutation = self.config_mutation.lock().await;
            let before = self.runtime.status().await;
            self.runtime
                .stop("restart")
                .await
                .context("stop runtime for restart")?;
            ctx.emit(RuntimeShutdown {
                generation: before.generation,
                reason: "restart".into(),
                shutdown_at_ms: crate::runtime::now_ms()?,
            })?;

            let desired = self.snapshot().await;
            let boot_result = self.runtime.boot(&desired.desired, desired.revision).await;
            let observed_status = self.runtime.status().await;
            self.mark_runtime_result(&ctx, &observed_status).await?;
            let status = boot_result.context("boot replacement runtime")?;
            self.pin_runtime_software(&ctx).await?;
            ctx.emit(RuntimeBooted {
                generation: status.generation,
                config_revision: desired.revision,
                booted_at_ms: status
                    .last_boot_at_ms
                    .ok_or_else(|| anyhow::anyhow!("ready runtime has no boot timestamp"))?,
            })?;
            Ok(status)
        })
    }
}

impl AgentOsActor {
    pub(crate) async fn mark_runtime_result(
        &self,
        ctx: &Ctx<Self>,
        status: &RuntimeStatus,
    ) -> Result<()> {
        let mut snapshot = self.config.lock().await;
        snapshot.applied_revision = status.applied_config_revision;
        snapshot.status = if status.lifecycle == crate::RuntimeLifecycleState::Ready {
            crate::ConfigApplyState::Ready
        } else {
            crate::ConfigApplyState::Failed
        };
        snapshot.issues = status.issues.clone();
        snapshot.updated_at_ms = crate::runtime::now_ms()?;
        ctx.set_state(crate::AgentOsActorState {
            config: snapshot.clone(),
        });
        store::persist(ctx, &snapshot).await?;
        Ok(())
    }
}
