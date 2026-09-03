use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use agentos_client::InstalledSoftware;
use anyhow::{anyhow, bail, Result};
use rivetkit::{Action, Ctx, Handles};
use serde::{Deserialize, Serialize};

use crate::config::{
    normalize_remote_source, RemotePackageSource, RemotePackageSourceInput, MAX_REMOTE_SOFTWARE,
};
use crate::{store, AgentOsActor, AgentOsActorState, ConfigApplyState, ConfigSnapshot};

type BoxFuture<T> = Pin<Box<dyn Future<Output = Result<T>> + Send>>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SoftwareInstall {
    pub source: RemotePackageSourceInput,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
}

impl Action for SoftwareInstall {
    type Output = SoftwareMutationResult;

    const NAME: &'static str = "software.install";
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SoftwareUninstall {
    pub package_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
}

impl Action for SoftwareUninstall {
    type Output = SoftwareMutationResult;

    const NAME: &'static str = "software.uninstall";
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SoftwareList;

impl Action for SoftwareList {
    type Output = Vec<InstalledSoftware>;

    const NAME: &'static str = "software.list";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareMutationResult {
    pub software: InstalledSoftware,
    pub config: ConfigSnapshot,
}

impl Handles<SoftwareInstall> for AgentOsActor {
    type Future = BoxFuture<SoftwareMutationResult>;

    fn handle(self: Arc<Self>, ctx: Ctx<Self>, action: SoftwareInstall) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let source = normalize_remote_source(action.source)?;
            let _mutation = self.config_mutation.lock().await;
            let current = self.snapshot().await;
            require_revision(&current, action.expected_revision)?;
            let already_desired = source.digest.as_deref().is_some_and(|package_id| {
                current
                    .desired
                    .software
                    .iter()
                    .any(|entry| entry.package_id.as_deref() == Some(package_id))
            });
            if current.desired.software.len() >= MAX_REMOTE_SOFTWARE && !already_desired {
                bail!(
                    "limit_exceeded: software has {} entries; maximum is {MAX_REMOTE_SOFTWARE}; uninstall a package before adding another",
                    current.desired.software.len()
                );
            }

            let installed = self.runtime.install_software(&source).await?;
            if current
                .desired
                .software
                .iter()
                .any(|entry| entry.package_id.as_deref() == Some(installed.package_id.as_str()))
            {
                crate::preload::observe_software_usage(&source.url, &installed).await;
                return Ok(SoftwareMutationResult {
                    software: installed,
                    config: current,
                });
            }

            let mut next = current.clone();
            next.desired.software.push(RemotePackageSource::resolved(
                source.url.clone(),
                &installed,
            ));
            next.revision = next
                .revision
                .checked_add(1)
                .ok_or_else(|| anyhow!("actor config revision overflow"))?;
            next.applied_revision = Some(next.revision);
            next.status = ConfigApplyState::Ready;
            next.updated_at_ms = crate::runtime::now_ms()?;

            if let Err(error) = persist_snapshot(&self, &ctx, &next).await {
                return match self.runtime.uninstall_software(&installed.package_id).await {
                    Ok(_) => Err(error.context("persist software installation")),
                    Err(rollback_error) => Err(error.context(format!(
                        "persist software installation; Core rollback also failed: {rollback_error:#}"
                    ))),
                };
            }
            self.runtime
                .set_applied_config_revision(next.revision)
                .await;
            crate::preload::observe_software_usage(&source.url, &installed).await;
            Ok(SoftwareMutationResult {
                software: installed,
                config: next,
            })
        })
    }
}

impl Handles<SoftwareUninstall> for AgentOsActor {
    type Future = BoxFuture<SoftwareMutationResult>;

    fn handle(self: Arc<Self>, ctx: Ctx<Self>, action: SoftwareUninstall) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_package_id(&action.package_id)?;
            let _mutation = self.config_mutation.lock().await;
            let current = self.snapshot().await;
            require_revision(&current, action.expected_revision)?;
            let index = current
                .desired
                .software
                .iter()
                .position(|source| source.package_id.as_deref() == Some(&action.package_id))
                .ok_or_else(|| anyhow!("software_not_found: {}", action.package_id))?;
            let removed_source = current.desired.software[index].clone();
            let removed = self.runtime.uninstall_software(&action.package_id).await?;

            let mut next = current.clone();
            next.desired.software.remove(index);
            next.revision = next
                .revision
                .checked_add(1)
                .ok_or_else(|| anyhow!("actor config revision overflow"))?;
            next.applied_revision = Some(next.revision);
            next.status = ConfigApplyState::Ready;
            next.updated_at_ms = crate::runtime::now_ms()?;

            if let Err(error) = persist_snapshot(&self, &ctx, &next).await {
                return match self.runtime.install_software(&removed_source).await {
                    Ok(_) => Err(error.context("persist software uninstall")),
                    Err(rollback_error) => Err(error.context(format!(
                        "persist software uninstall; Core rollback also failed: {rollback_error:#}"
                    ))),
                };
            }
            self.runtime
                .set_applied_config_revision(next.revision)
                .await;
            Ok(SoftwareMutationResult {
                software: removed,
                config: next,
            })
        })
    }
}

impl Handles<SoftwareList> for AgentOsActor {
    type Future = BoxFuture<Vec<InstalledSoftware>>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, _action: SoftwareList) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            self.runtime.list_software().await
        })
    }
}

impl AgentOsActor {
    pub(crate) async fn pin_runtime_software(&self, ctx: &Ctx<Self>) -> Result<()> {
        let resolved = self.runtime.resolved_software().await;
        let mut next = self.snapshot().await;
        if resolved.len() != next.desired.software.len() {
            bail!(
                "runtime resolved {} packages for {} desired sources",
                resolved.len(),
                next.desired.software.len()
            );
        }
        let mut changed = false;
        for (source, resolved) in next.desired.software.iter_mut().zip(resolved) {
            if source.url != resolved.url {
                bail!("runtime package resolution order does not match desired software");
            }
            let pinned = RemotePackageSource::resolved(source.url.clone(), &resolved.installed);
            if *source != pinned {
                *source = pinned;
                changed = true;
            }
        }
        if changed {
            persist_snapshot(self, ctx, &next).await?;
        }
        for resolved in self.runtime.resolved_software().await {
            crate::preload::observe_software_usage(&resolved.url, &resolved.installed).await;
        }
        Ok(())
    }
}

pub(crate) async fn persist_snapshot(
    actor: &AgentOsActor,
    ctx: &Ctx<AgentOsActor>,
    snapshot: &ConfigSnapshot,
) -> Result<()> {
    store::persist(ctx, snapshot).await?;
    *actor.config.lock().await = snapshot.clone();
    ctx.set_state(AgentOsActorState {
        config: snapshot.clone(),
    });
    Ok(())
}

pub(crate) fn require_revision(snapshot: &ConfigSnapshot, expected: Option<u64>) -> Result<()> {
    if let Some(expected) = expected {
        if expected != snapshot.revision {
            bail!(
                "config_conflict: expected revision {expected}, current revision is {}",
                snapshot.revision
            );
        }
    }
    Ok(())
}

fn validate_package_id(package_id: &str) -> Result<()> {
    let Some(digest) = package_id.strip_prefix("sha256:") else {
        bail!("packageId must use the sha256:<64 lowercase hex> form");
    };
    if digest.len() != 64
        || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        || digest.bytes().any(|byte| byte.is_ascii_uppercase())
    {
        bail!("packageId must use the sha256:<64 lowercase hex> form");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_id_is_content_addressed() {
        assert!(validate_package_id(&format!("sha256:{}", "a".repeat(64))).is_ok());
        assert!(validate_package_id("package-name").is_err());
    }

    #[test]
    fn actor_source_cannot_deserialize_a_path_variant() {
        let error = serde_json::from_value::<RemotePackageSourceInput>(serde_json::json!({
            "url": "https://example.com/tool.aospkg",
            "path": "/tmp/tool.aospkg"
        }))
        .expect_err("host path must be rejected");
        assert!(error.to_string().contains("unknown field `path`"));
    }
}
