use std::collections::BTreeSet;

use agentos_client::{AgentOsConfig, AgentOsLimits, VmSqliteDescriptor, VmUserConfig};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

const MAX_ALLOWED_NODE_BUILTINS: usize = 256;
const MAX_ALLOWED_NODE_BUILTIN_BYTES: usize = 128;
const MAX_LOOPBACK_EXEMPT_PORTS: usize = 256;

/// Callback-free configuration accepted by the hosted actor.
///
/// This is deliberately smaller than [`AgentOsConfig`]. The hosted actor never
/// accepts bindings, host mounts, local package paths, a sidecar handle, or a
/// custom scheduler. Later feature revisions extend this closed shape with the
/// serializable hosted filesystem and remote-package descriptors.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentOsActorConfigInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<VmUserConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_node_builtins: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loopback_exempt_ports: Option<Vec<u16>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<AgentOsLimits>,
}

/// Complete persisted actor configuration for the fields supported by this
/// revision. Optional values are explicit Core-default selections, not omitted
/// input, and collections are always materialized.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentOsActorConfig {
    pub user: Option<VmUserConfig>,
    pub allowed_node_builtins: Option<Vec<String>>,
    pub loopback_exempt_ports: Vec<u16>,
    pub limits: Option<AgentOsLimits>,
}

impl AgentOsActorConfig {
    pub fn normalize(input: AgentOsActorConfigInput) -> Result<Self> {
        let allowed_node_builtins = input
            .allowed_node_builtins
            .map(normalize_allowed_node_builtins)
            .transpose()?;
        let loopback_exempt_ports =
            normalize_loopback_ports(input.loopback_exempt_ports.unwrap_or_default())?;
        let config = Self {
            user: input.user,
            allowed_node_builtins,
            loopback_exempt_ports,
            limits: input.limits,
        };

        // Reuse the Rust Core client's VM serializer and canonical vm-config
        // validation. The actor owns only hosted-boundary bounds above.
        config.to_core_config(None, None).validate()?;
        Ok(config)
    }

    pub(crate) fn to_core_config(
        &self,
        sidecar_binary_path: Option<String>,
        database_path: Option<String>,
    ) -> AgentOsConfig {
        let mut config = AgentOsConfig::default();
        config.user = self.user.clone();
        config.allowed_node_builtins = self.allowed_node_builtins.clone();
        config.loopback_exempt_ports = self.loopback_exempt_ports.clone();
        config.limits = self.limits.clone();
        config.sidecar_binary_path = sidecar_binary_path;
        config.database = database_path.map(|path| VmSqliteDescriptor::SqliteFile { path });
        config
    }
}

fn normalize_allowed_node_builtins(mut values: Vec<String>) -> Result<Vec<String>> {
    if values.len() > MAX_ALLOWED_NODE_BUILTINS {
        bail!("allowedNodeBuiltins exceeds limit of {MAX_ALLOWED_NODE_BUILTINS}; reduce the list");
    }
    if let Some(value) = values
        .iter()
        .find(|value| value.is_empty() || value.len() > MAX_ALLOWED_NODE_BUILTIN_BYTES)
    {
        bail!(
            "allowedNodeBuiltins entry {value:?} must contain 1..={MAX_ALLOWED_NODE_BUILTIN_BYTES} bytes"
        );
    }
    values.sort();
    values.dedup();
    Ok(values)
}

fn normalize_loopback_ports(values: Vec<u16>) -> Result<Vec<u16>> {
    if values.len() > MAX_LOOPBACK_EXEMPT_PORTS {
        bail!("loopbackExemptPorts exceeds limit of {MAX_LOOPBACK_EXEMPT_PORTS}; reduce the list");
    }
    let ports = values.into_iter().collect::<BTreeSet<_>>();
    Ok(ports.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_materializes_defaults_and_canonicalizes_sets() {
        let normalized = AgentOsActorConfig::normalize(AgentOsActorConfigInput {
            allowed_node_builtins: Some(vec!["path".into(), "fs".into(), "path".into()]),
            loopback_exempt_ports: Some(vec![8080, 80, 8080]),
            ..AgentOsActorConfigInput::default()
        })
        .expect("normalize config");

        assert_eq!(
            normalized.allowed_node_builtins,
            Some(vec!["fs".into(), "path".into()])
        );
        assert_eq!(normalized.loopback_exempt_ports, vec![80, 8080]);
        assert_eq!(
            AgentOsActorConfig::normalize(AgentOsActorConfigInput::default())
                .expect("normalize default config"),
            AgentOsActorConfig::default()
        );
    }

    #[test]
    fn normalization_rejects_oversized_collections() {
        let error = AgentOsActorConfig::normalize(AgentOsActorConfigInput {
            loopback_exempt_ports: Some(vec![80; MAX_LOOPBACK_EXEMPT_PORTS + 1]),
            ..AgentOsActorConfigInput::default()
        })
        .expect_err("oversized list must fail");
        assert!(error
            .to_string()
            .contains("loopbackExemptPorts exceeds limit"));
    }
}
