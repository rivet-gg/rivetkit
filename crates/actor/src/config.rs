use std::collections::BTreeSet;

use agentos_client::{
    AgentOsConfig, AgentOsLimits, MountConfig, MountPlugin, PackageResolver,
    PackageResolverOptions, PackageSource, RootFilesystemConfig, RootFilesystemKind,
    RootFilesystemMode, VmSqliteDescriptor, VmUserConfig,
};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

const MAX_ALLOWED_NODE_BUILTINS: usize = 256;
const MAX_ALLOWED_NODE_BUILTIN_BYTES: usize = 128;
const MAX_LOOPBACK_EXEMPT_PORTS: usize = 256;
const MAX_HOSTED_MOUNTS: usize = 32;
const MAX_FILESYSTEM_PATH_BYTES: usize = 4 * 1024;
const MAX_FILESYSTEM_NAMESPACE_BYTES: usize = 128;
pub(crate) const MAX_REMOTE_SOFTWARE: usize = 128;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filesystem: Option<HostedFilesystemConfigInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub software: Option<Vec<RemotePackageSourceInput>>,
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
    pub filesystem: HostedFilesystemConfig,
    pub software: Vec<RemotePackageSource>,
}

/// URL-only hosted package input. This is intentionally not a serde wrapper
/// around Core's `PackageSource`, whose trusted `Path` variant must remain
/// impossible to construct through an actor action or creation payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePackageSourceInput {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePackageSource {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedFilesystemConfigInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<HostedRootFilesystemInput>,
    #[serde(default)]
    pub mounts: Vec<HostedFilesystemMountInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum HostedRootFilesystemInput {
    Default,
    ActorSqlite {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        namespace: Option<String>,
        #[serde(default, rename = "readOnly")]
        read_only: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedFilesystemMountInput {
    pub path: String,
    pub backend: HostedFilesystemBackendInput,
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum HostedFilesystemBackendInput {
    ActorSqlite {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        namespace: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedFilesystemConfig {
    pub root: HostedRootFilesystem,
    pub mounts: Vec<HostedFilesystemMount>,
}

impl Default for HostedFilesystemConfig {
    fn default() -> Self {
        Self {
            root: HostedRootFilesystem::Default,
            mounts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum HostedRootFilesystem {
    Default,
    ActorSqlite {
        namespace: String,
        #[serde(rename = "readOnly")]
        read_only: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedFilesystemMount {
    pub path: String,
    pub backend: HostedFilesystemBackend,
    pub read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum HostedFilesystemBackend {
    ActorSqlite { namespace: String },
}

impl AgentOsActorConfig {
    pub fn normalize(input: AgentOsActorConfigInput) -> Result<Self> {
        let allowed_node_builtins = input
            .allowed_node_builtins
            .map(normalize_allowed_node_builtins)
            .transpose()?;
        let loopback_exempt_ports =
            normalize_loopback_ports(input.loopback_exempt_ports.unwrap_or_default())?;
        let filesystem = normalize_filesystem(input.filesystem.unwrap_or_default())?;
        let software = normalize_remote_software(input.software.unwrap_or_default())?;
        let config = Self {
            user: input.user,
            allowed_node_builtins,
            loopback_exempt_ports,
            limits: input.limits,
            filesystem,
            software,
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
        config.root_filesystem = self.filesystem.root.to_core();
        config.mounts = self
            .filesystem
            .mounts
            .iter()
            .map(HostedFilesystemMount::to_core)
            .collect();
        config.sidecar_binary_path = sidecar_binary_path;
        config.database = database_path.map(|path| VmSqliteDescriptor::SqliteFile { path });
        if std::env::var("AGENTOS_ALLOW_INSECURE_LOCAL_PACKAGE_HTTP").as_deref() == Ok("1") {
            config.package_resolver.allow_insecure_local_http = true;
        }
        config
    }
}

impl RemotePackageSource {
    pub(crate) fn to_core(&self) -> PackageSource {
        PackageSource::Url {
            url: self.url.clone(),
            expected_digest: self.digest.clone(),
        }
    }

    pub(crate) fn resolved(url: String, installed: &agentos_client::InstalledSoftware) -> Self {
        Self {
            url,
            digest: Some(installed.digest.clone()),
            size: Some(installed.size),
            package_id: Some(installed.package_id.clone()),
        }
    }
}

pub(crate) fn normalize_remote_source(
    source: RemotePackageSourceInput,
) -> Result<RemotePackageSource> {
    let resolver = PackageResolver::new(PackageResolverOptions::default())?;
    resolver.validate_source(&PackageSource::Url {
        url: source.url.clone(),
        expected_digest: source.digest.clone(),
    })?;
    Ok(RemotePackageSource {
        package_id: source.digest.clone(),
        url: source.url,
        digest: source.digest,
        size: None,
    })
}

fn normalize_remote_software(
    sources: Vec<RemotePackageSourceInput>,
) -> Result<Vec<RemotePackageSource>> {
    if sources.len() > MAX_REMOTE_SOFTWARE {
        bail!(
            "software exceeds limit of {MAX_REMOTE_SOFTWARE}; reduce the package source collection"
        );
    }
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::with_capacity(sources.len());
    for source in sources {
        let source = normalize_remote_source(source)?;
        let identity = (source.url.clone(), source.digest.clone());
        if !seen.insert(identity) {
            continue;
        }
        normalized.push(source);
    }
    Ok(normalized)
}

impl HostedRootFilesystem {
    fn to_core(&self) -> RootFilesystemConfig {
        match self {
            Self::Default => RootFilesystemConfig::default(),
            Self::ActorSqlite {
                namespace,
                read_only,
            } => RootFilesystemConfig {
                kind: RootFilesystemKind::Native,
                mode: Some(if *read_only {
                    RootFilesystemMode::ReadOnly
                } else {
                    RootFilesystemMode::Ephemeral
                }),
                native_plugin: Some(actor_sqlite_plugin(namespace)),
                disable_default_base_layer: true,
                lowers: Vec::new(),
            },
        }
    }
}

impl HostedFilesystemMount {
    fn to_core(&self) -> MountConfig {
        let HostedFilesystemBackend::ActorSqlite { namespace } = &self.backend;
        MountConfig::Native {
            path: self.path.clone(),
            plugin: actor_sqlite_plugin(namespace),
            guest_source: Some("actor-sqlite".into()),
            guest_fstype: Some("actor-sqlite".into()),
            read_only: self.read_only,
        }
    }
}

fn actor_sqlite_plugin(namespace: &str) -> MountPlugin {
    MountPlugin {
        id: "chunked_sqlite".into(),
        config: Some(serde_json::json!({ "namespace": namespace })),
    }
}

fn normalize_filesystem(input: HostedFilesystemConfigInput) -> Result<HostedFilesystemConfig> {
    if input.mounts.len() > MAX_HOSTED_MOUNTS {
        bail!(
            "filesystem.mounts exceeds limit of {MAX_HOSTED_MOUNTS}; reduce the mount collection"
        );
    }

    let root = match input.root.unwrap_or(HostedRootFilesystemInput::Default) {
        HostedRootFilesystemInput::Default => HostedRootFilesystem::Default,
        HostedRootFilesystemInput::ActorSqlite {
            namespace,
            read_only,
        } => HostedRootFilesystem::ActorSqlite {
            namespace: normalize_namespace(namespace.unwrap_or_else(|| "actor-root".into()))?,
            read_only,
        },
    };

    let mut mounts = Vec::with_capacity(input.mounts.len());
    let mut namespaces = BTreeSet::new();
    if let HostedRootFilesystem::ActorSqlite { namespace, .. } = &root {
        namespaces.insert(namespace.clone());
    }
    for (index, mount) in input.mounts.into_iter().enumerate() {
        validate_hosted_mount_path(&mount.path)?;
        let backend = match mount.backend {
            HostedFilesystemBackendInput::ActorSqlite { namespace } => {
                let namespace = normalize_namespace(
                    namespace.unwrap_or_else(|| format!("actor-mount-{index}")),
                )?;
                if !namespaces.insert(namespace.clone()) {
                    bail!("actor-sqlite namespace {namespace:?} is used more than once");
                }
                HostedFilesystemBackend::ActorSqlite { namespace }
            }
        };
        if mounts
            .iter()
            .any(|existing: &HostedFilesystemMount| paths_overlap(&existing.path, &mount.path))
        {
            bail!(
                "filesystem mount path {:?} overlaps another configured mount",
                mount.path
            );
        }
        mounts.push(HostedFilesystemMount {
            path: mount.path,
            backend,
            read_only: mount.read_only,
        });
    }

    Ok(HostedFilesystemConfig { root, mounts })
}

fn validate_hosted_mount_path(path: &str) -> Result<()> {
    if path.is_empty() || path.len() > MAX_FILESYSTEM_PATH_BYTES {
        bail!("filesystem mount path must contain 1..={MAX_FILESYSTEM_PATH_BYTES} bytes");
    }
    if !path.starts_with('/') || path == "/" || path.ends_with('/') {
        bail!("filesystem mount path must be a normalized, non-root absolute path");
    }
    if path.split('/').any(|part| part == "." || part == "..") {
        bail!("filesystem mount path must not contain traversal segments");
    }
    if ["/proc", "/etc/agentos", "/opt/agentos", "/__agentos"]
        .iter()
        .any(|reserved| path == *reserved || path.starts_with(&format!("{reserved}/")))
    {
        bail!("filesystem mount path {path:?} is reserved by agentOS");
    }
    Ok(())
}

fn paths_overlap(left: &str, right: &str) -> bool {
    left == right
        || left
            .strip_prefix(right)
            .is_some_and(|suffix| suffix.starts_with('/'))
        || right
            .strip_prefix(left)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn normalize_namespace(namespace: String) -> Result<String> {
    if namespace.is_empty() || namespace.len() > MAX_FILESYSTEM_NAMESPACE_BYTES {
        bail!("actor-sqlite namespace must contain 1..={MAX_FILESYSTEM_NAMESPACE_BYTES} bytes");
    }
    if !namespace
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        bail!("actor-sqlite namespace may contain only ASCII letters, digits, '-', '_', and '.'");
    }
    Ok(namespace)
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
        assert_eq!(normalized.filesystem, HostedFilesystemConfig::default());
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

    #[test]
    fn filesystem_registry_is_closed_and_materializes_namespaces() {
        let normalized = AgentOsActorConfig::normalize(AgentOsActorConfigInput {
            filesystem: Some(HostedFilesystemConfigInput {
                root: Some(HostedRootFilesystemInput::ActorSqlite {
                    namespace: None,
                    read_only: false,
                }),
                mounts: vec![HostedFilesystemMountInput {
                    path: "/workspace".into(),
                    backend: HostedFilesystemBackendInput::ActorSqlite { namespace: None },
                    read_only: false,
                }],
            }),
            ..AgentOsActorConfigInput::default()
        })
        .expect("normalize hosted filesystem");

        assert_eq!(
            normalized.filesystem.root,
            HostedRootFilesystem::ActorSqlite {
                namespace: "actor-root".into(),
                read_only: false,
            }
        );
        assert_eq!(
            normalized.filesystem.mounts[0].backend,
            HostedFilesystemBackend::ActorSqlite {
                namespace: "actor-mount-0".into(),
            }
        );
        assert_eq!(normalized.filesystem.mounts[0].path, "/workspace");
    }

    #[test]
    fn filesystem_registry_rejects_reserved_and_overlapping_mounts() {
        let mount = |path: &str, namespace: &str| HostedFilesystemMountInput {
            path: path.into(),
            backend: HostedFilesystemBackendInput::ActorSqlite {
                namespace: Some(namespace.into()),
            },
            read_only: false,
        };
        for path in ["/", "/proc", "/opt/agentos/packages", "/a/../b"] {
            let error = normalize_filesystem(HostedFilesystemConfigInput {
                root: None,
                mounts: vec![mount(path, "one")],
            })
            .expect_err("unsafe mount must fail");
            assert!(error.to_string().contains("mount path"));
        }

        let error = normalize_filesystem(HostedFilesystemConfigInput {
            root: None,
            mounts: vec![mount("/workspace", "one"), mount("/workspace/cache", "two")],
        })
        .expect_err("overlap must fail");
        assert!(error.to_string().contains("overlaps"));
    }
}
