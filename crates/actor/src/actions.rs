use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use anyhow::{Context, Result};
use rivetkit::{Action, Ctx, Handles};
use serde::{Deserialize, Serialize};

use crate::config::resolve_remote_software;
use crate::events::{RuntimeBooted, RuntimeShutdown};
use crate::runtime::RuntimeStatus;
use crate::software::{persist_snapshot, require_revision};
use crate::{store, AgentOsActor, AgentOsActorConfig, AgentOsActorConfigInput, ConfigSnapshot};

pub(crate) type BoxFuture<T> = Pin<Box<dyn Future<Output = Result<T>> + Send>>;

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigGet;

impl Action for ConfigGet {
    type Output = ConfigSnapshot;

    const NAME: &'static str = "config.get";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigSet {
    pub config: AgentOsActorConfigInput,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
}

impl Action for ConfigSet {
    type Output = ConfigSnapshot;

    const NAME: &'static str = "config.set";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Serialize, Deserialize)]
pub struct RuntimeStatusGet;

impl Action for RuntimeStatusGet {
    type Output = RuntimeStatus;

    const NAME: &'static str = "runtime.status";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
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

impl Handles<ConfigSet> for AgentOsActor {
    type Future = BoxFuture<ConfigSnapshot>;

    fn handle(self: Arc<Self>, ctx: Ctx<Self>, action: ConfigSet) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;

            // Reject a known-stale conditional write before doing network work,
            // then compare again under the mutation lock before committing.
            require_revision(&self.snapshot().await, action.expected_revision)?;
            let mut desired = AgentOsActorConfig::normalize(action.config)
                .context("normalize replacement agentOS actor config")?;
            desired.software = resolve_remote_software(desired.software).await?;

            let _mutation = self.config_mutation.lock().await;
            let current = self.snapshot().await;
            require_revision(&current, action.expected_revision)?;
            if current.desired == desired {
                return Ok(current);
            }

            let core_changed = !current.desired.core_runtime_eq(&desired);
            let next = replacement_snapshot(&current, desired, core_changed)?;
            persist_snapshot(&self, &ctx, &next).await?;
            if core_changed {
                self.runtime
                    .set_desired_config_revision(next.revision)
                    .await;
            } else if next.applied_revision == Some(next.revision) {
                self.runtime
                    .set_applied_config_revision(next.revision)
                    .await;
            }
            Ok(next)
        })
    }
}

fn replacement_snapshot(
    current: &ConfigSnapshot,
    desired: AgentOsActorConfig,
    core_changed: bool,
) -> Result<ConfigSnapshot> {
    let revision = current
        .revision
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("actor config revision overflow"))?;
    let runtime_was_applied = current.applied_revision == Some(current.revision)
        && current.status == crate::ConfigApplyState::Ready;
    Ok(ConfigSnapshot {
        revision,
        desired,
        applied_revision: if core_changed {
            current.applied_revision
        } else if runtime_was_applied {
            Some(revision)
        } else {
            current.applied_revision
        },
        status: if core_changed {
            crate::ConfigApplyState::RestartRequired
        } else if runtime_was_applied {
            crate::ConfigApplyState::Ready
        } else {
            current.status
        },
        issues: if core_changed {
            Vec::new()
        } else {
            current.issues.clone()
        },
        created_at_ms: current.created_at_ms,
        updated_at_ms: crate::runtime::now_ms()?,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ConfigApplyState, PreviewPolicyInput};

    fn ready_snapshot(desired: AgentOsActorConfig) -> ConfigSnapshot {
        ConfigSnapshot {
            revision: 7,
            desired,
            applied_revision: Some(7),
            status: ConfigApplyState::Ready,
            issues: Vec::new(),
            created_at_ms: 1,
            updated_at_ms: 1,
        }
    }

    #[test]
    fn replacement_resets_omitted_fields_and_requires_restart_for_core_changes() {
        let current = ready_snapshot(
            AgentOsActorConfig::normalize(AgentOsActorConfigInput {
                environment: Some(std::collections::BTreeMap::from([(
                    String::from("TOKEN"),
                    String::from("value"),
                )])),
                high_resolution_time: Some(true),
                ..Default::default()
            })
            .expect("current config"),
        );
        let desired = AgentOsActorConfig::normalize(AgentOsActorConfigInput::default())
            .expect("default replacement");
        let next = replacement_snapshot(&current, desired, true).expect("replacement");

        assert_eq!(next.revision, 8);
        assert_eq!(next.desired.environment, None);
        assert!(!next.desired.high_resolution_time);
        assert_eq!(next.applied_revision, Some(7));
        assert_eq!(next.status, ConfigApplyState::RestartRequired);
    }

    #[test]
    fn actor_only_preview_replacement_applies_without_restarting_core() {
        let current = ready_snapshot(AgentOsActorConfig::default());
        let desired = AgentOsActorConfig::normalize(AgentOsActorConfigInput {
            preview: Some(PreviewPolicyInput {
                max_active: Some(4),
                ..Default::default()
            }),
            ..Default::default()
        })
        .expect("preview replacement");
        assert!(current.desired.core_runtime_eq(&desired));

        let next = replacement_snapshot(&current, desired, false).expect("replacement");
        assert_eq!(next.applied_revision, Some(8));
        assert_eq!(next.status, ConfigApplyState::Ready);
    }

    #[test]
    fn revision_checks_conflict_and_unconditional_replacements_are_monotonic() {
        let current = ready_snapshot(AgentOsActorConfig::default());
        let error = require_revision(&current, Some(6)).expect_err("stale writer must fail");
        assert!(error.to_string().contains("config_conflict"));
        require_revision(&current, Some(7)).expect("current writer");
        require_revision(&current, None).expect("unconditional writer");

        let first = replacement_snapshot(
            &current,
            AgentOsActorConfig {
                high_resolution_time: true,
                ..Default::default()
            },
            true,
        )
        .expect("first replacement");
        let second = replacement_snapshot(
            &first,
            AgentOsActorConfig {
                environment: Some(std::collections::BTreeMap::new()),
                ..Default::default()
            },
            true,
        )
        .expect("last writer wins");
        assert_eq!(first.revision, 8);
        assert_eq!(second.revision, 9);
        assert_eq!(second.desired.environment, Some(Default::default()));
    }

    #[test]
    fn config_snapshot_uses_the_public_state_field() {
        let encoded = serde_json::to_value(ready_snapshot(AgentOsActorConfig::default()))
            .expect("serialize snapshot");
        assert_eq!(encoded["state"], "ready");
        assert!(encoded.get("status").is_none());
    }
}
