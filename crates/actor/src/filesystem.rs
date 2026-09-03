use std::sync::Arc;

use agentos_client::{
    BatchWriteEntry, FileContent, MkdirOptions, MountInfo, ReaddirRecursiveOptions, RemoveOptions,
    RootSnapshotExport, VirtualStat,
};
use anyhow::{bail, Result};
use rivetkit::{Action, Ctx, Handles};
use serde::{Deserialize, Serialize};

use crate::actions::BoxFuture;
use crate::AgentOsActor;

const MAX_PATH_BYTES: usize = 4 * 1024;
const MAX_BATCH_PATHS: usize = 128;
const MAX_TRANSFER_BYTES: usize = 768 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 4_096;
const MAX_DIRECTORY_RESULT_BYTES: usize = 512 * 1024;
const MAX_RECURSION_DEPTH: u32 = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FileBytes(#[serde(with = "serde_bytes")] pub Vec<u8>);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FileContentInput {
    Text(String),
    Bytes(#[serde(with = "serde_bytes")] Vec<u8>),
}

impl FileContentInput {
    fn byte_len(&self) -> usize {
        match self {
            Self::Text(value) => value.len(),
            Self::Bytes(value) => value.len(),
        }
    }

    fn into_core(self) -> FileContent {
        match self {
            Self::Text(value) => FileContent::Text(value),
            Self::Bytes(value) => FileContent::Bytes(value),
        }
    }
}

macro_rules! path_action {
    ($name:ident, $output:ty, $wire_name:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name {
            pub path: String,
        }

        impl Action for $name {
            type Output = $output;
            const NAME: &'static str = $wire_name;
        }
    };
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemReadFile {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
}

impl Action for FilesystemReadFile {
    type Output = FileBytes;
    const NAME: &'static str = "filesystem.readFile";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemWriteFile {
    pub path: String,
    pub content: FileContentInput,
}

impl Action for FilesystemWriteFile {
    type Output = ();
    const NAME: &'static str = "filesystem.writeFile";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemReadFiles {
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
}

impl Action for FilesystemReadFiles {
    type Output = Vec<FilesystemReadResult>;
    const NAME: &'static str = "filesystem.readFiles";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemReadResult {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<FileBytes>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemWriteFiles {
    pub entries: Vec<FilesystemWriteEntry>,
}

impl Action for FilesystemWriteFiles {
    type Output = Vec<FilesystemWriteResult>;
    const NAME: &'static str = "filesystem.writeFiles";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemWriteEntry {
    pub path: String,
    pub content: FileContentInput,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemWriteResult {
    pub path: String,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

path_action!(FilesystemStat, VirtualStat, "filesystem.stat");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemMkdir {
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
}

impl Action for FilesystemMkdir {
    type Output = ();
    const NAME: &'static str = "filesystem.mkdir";
}

path_action!(FilesystemReaddir, Vec<String>, "filesystem.readdir");
path_action!(
    FilesystemReaddirEntries,
    Vec<FilesystemDirectoryEntry>,
    "filesystem.readdirEntries"
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemDirectoryEntry {
    pub name: String,
    pub is_directory: bool,
    pub is_symbolic_link: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemReaddirRecursive {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<u32>,
    #[serde(default)]
    pub exclude: Vec<String>,
}

impl Action for FilesystemReaddirRecursive {
    type Output = Vec<agentos_client::DirEntry>;
    const NAME: &'static str = "filesystem.readdirRecursive";
}

path_action!(FilesystemExists, bool, "filesystem.exists");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemMove {
    pub from: String,
    pub to: String,
}

impl Action for FilesystemMove {
    type Output = ();
    const NAME: &'static str = "filesystem.move";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemRemove {
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
}

impl Action for FilesystemRemove {
    type Output = ();
    const NAME: &'static str = "filesystem.remove";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemExport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
}

impl Action for FilesystemExport {
    type Output = RootSnapshotExport;
    const NAME: &'static str = "filesystem.export";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilesystemListMounts;

impl Action for FilesystemListMounts {
    type Output = Vec<MountInfo>;
    const NAME: &'static str = "filesystem.listMounts";
}

impl Handles<FilesystemReadFile> for AgentOsActor {
    type Future = BoxFuture<FileBytes>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemReadFile) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            let max_bytes = transfer_limit(action.max_bytes)?;
            let content = self.runtime.vm().await?.read_file(&action.path).await?;
            validate_bytes("filesystem.readFile result", content.len(), max_bytes)?;
            Ok(FileBytes(content))
        })
    }
}

impl Handles<FilesystemWriteFile> for AgentOsActor {
    type Future = BoxFuture<()>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemWriteFile) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            validate_bytes(
                "filesystem.writeFile content",
                action.content.byte_len(),
                MAX_TRANSFER_BYTES,
            )?;
            self.runtime
                .vm()
                .await?
                .write_file(&action.path, action.content.into_core())
                .await
        })
    }
}

impl Handles<FilesystemReadFiles> for AgentOsActor {
    type Future = BoxFuture<Vec<FilesystemReadResult>>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemReadFiles) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_paths(&action.paths)?;
            let max_bytes = transfer_limit(action.max_bytes)?;
            let vm = self.runtime.vm().await?;
            let mut total = 0usize;
            let mut results = Vec::with_capacity(action.paths.len());
            for path in action.paths {
                match vm.read_file(&path).await {
                    Ok(content) => {
                        total = total.checked_add(content.len()).ok_or_else(|| {
                            anyhow::anyhow!(
                                "limit_exceeded: filesystem.readFiles byte count overflow"
                            )
                        })?;
                        validate_bytes("filesystem.readFiles result", total, max_bytes)?;
                        results.push(FilesystemReadResult {
                            path,
                            content: Some(FileBytes(content)),
                            error: None,
                        });
                    }
                    Err(error) => results.push(FilesystemReadResult {
                        path,
                        content: None,
                        error: Some(error.to_string()),
                    }),
                }
            }
            Ok(results)
        })
    }
}

impl Handles<FilesystemWriteFiles> for AgentOsActor {
    type Future = BoxFuture<Vec<FilesystemWriteResult>>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemWriteFiles) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_count(
                "filesystem.writeFiles entries",
                action.entries.len(),
                MAX_BATCH_PATHS,
            )?;
            let mut total = 0usize;
            let mut entries = Vec::with_capacity(action.entries.len());
            for entry in action.entries {
                validate_path(&entry.path)?;
                total = total.checked_add(entry.content.byte_len()).ok_or_else(|| {
                    anyhow::anyhow!("limit_exceeded: filesystem.writeFiles byte count overflow")
                })?;
                entries.push(BatchWriteEntry {
                    path: entry.path,
                    content: entry.content.into_core(),
                });
            }
            validate_bytes("filesystem.writeFiles content", total, MAX_TRANSFER_BYTES)?;
            Ok(self
                .runtime
                .vm()
                .await?
                .write_files(entries)
                .await
                .into_iter()
                .map(|result| FilesystemWriteResult {
                    path: result.path,
                    success: result.success,
                    error: result.error,
                })
                .collect())
        })
    }
}

impl Handles<FilesystemStat> for AgentOsActor {
    type Future = BoxFuture<VirtualStat>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemStat) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            self.runtime.vm().await?.stat(&action.path).await
        })
    }
}

impl Handles<FilesystemMkdir> for AgentOsActor {
    type Future = BoxFuture<()>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemMkdir) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            self.runtime
                .vm()
                .await?
                .mkdir(
                    &action.path,
                    MkdirOptions {
                        recursive: action.recursive,
                    },
                )
                .await
        })
    }
}

impl Handles<FilesystemReaddir> for AgentOsActor {
    type Future = BoxFuture<Vec<String>>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemReaddir) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            let entries = self.runtime.vm().await?.readdir(&action.path).await?;
            validate_directory_output(entries.len(), entries.iter().map(String::len).sum())?;
            Ok(entries)
        })
    }
}

impl Handles<FilesystemReaddirEntries> for AgentOsActor {
    type Future = BoxFuture<Vec<FilesystemDirectoryEntry>>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemReaddirEntries) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            let entries = self
                .runtime
                .vm()
                .await?
                .readdir_entries(&action.path)
                .await?;
            validate_directory_output(
                entries.len(),
                entries.iter().map(|entry| entry.name.len()).sum(),
            )?;
            Ok(entries
                .into_iter()
                .map(|entry| FilesystemDirectoryEntry {
                    name: entry.name,
                    is_directory: entry.is_directory,
                    is_symbolic_link: entry.is_symbolic_link,
                })
                .collect())
        })
    }
}

impl Handles<FilesystemReaddirRecursive> for AgentOsActor {
    type Future = BoxFuture<Vec<agentos_client::DirEntry>>;

    fn handle(
        self: Arc<Self>,
        _ctx: Ctx<Self>,
        action: FilesystemReaddirRecursive,
    ) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            if action
                .max_depth
                .is_some_and(|depth| depth > MAX_RECURSION_DEPTH)
            {
                bail!(
                    "limit_exceeded: filesystem.readdirRecursive maxDepth exceeds {MAX_RECURSION_DEPTH}; lower maxDepth"
                );
            }
            validate_count(
                "filesystem.readdirRecursive exclude",
                action.exclude.len(),
                MAX_BATCH_PATHS,
            )?;
            for value in &action.exclude {
                validate_string("filesystem.readdirRecursive exclude entry", value)?;
            }
            let entries = self
                .runtime
                .vm()
                .await?
                .readdir_recursive(
                    &action.path,
                    ReaddirRecursiveOptions {
                        max_depth: action.max_depth,
                        exclude: action.exclude,
                    },
                )
                .await?;
            validate_directory_output(
                entries.len(),
                entries.iter().map(|entry| entry.path.len()).sum(),
            )?;
            Ok(entries)
        })
    }
}

impl Handles<FilesystemExists> for AgentOsActor {
    type Future = BoxFuture<bool>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemExists) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            self.runtime.vm().await?.exists(&action.path).await
        })
    }
}

impl Handles<FilesystemMove> for AgentOsActor {
    type Future = BoxFuture<()>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemMove) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.from)?;
            validate_path(&action.to)?;
            self.runtime
                .vm()
                .await?
                .move_path(&action.from, &action.to)
                .await
        })
    }
}

impl Handles<FilesystemRemove> for AgentOsActor {
    type Future = BoxFuture<()>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemRemove) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_path(&action.path)?;
            self.runtime
                .vm()
                .await?
                .remove(
                    &action.path,
                    RemoveOptions {
                        recursive: action.recursive,
                    },
                )
                .await
        })
    }
}

impl Handles<FilesystemExport> for AgentOsActor {
    type Future = BoxFuture<RootSnapshotExport>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, action: FilesystemExport) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let max_bytes = transfer_limit(action.max_bytes)?;
            self.runtime
                .vm()
                .await?
                .export_root_filesystem(max_bytes)
                .await
        })
    }
}

impl Handles<FilesystemListMounts> for AgentOsActor {
    type Future = BoxFuture<Vec<MountInfo>>;

    fn handle(self: Arc<Self>, _ctx: Ctx<Self>, _action: FilesystemListMounts) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let mounts = self.runtime.vm().await?.list_mounts().await?;
            validate_count(
                "filesystem.listMounts result",
                mounts.len(),
                MAX_BATCH_PATHS,
            )?;
            Ok(mounts)
        })
    }
}

fn transfer_limit(requested: Option<usize>) -> Result<usize> {
    let limit = requested.unwrap_or(MAX_TRANSFER_BYTES);
    if limit == 0 || limit > MAX_TRANSFER_BYTES {
        bail!(
            "limit_exceeded: maxBytes must be between 1 and {MAX_TRANSFER_BYTES}; large-file streaming is not implemented"
        );
    }
    Ok(limit)
}

fn validate_paths(paths: &[String]) -> Result<()> {
    validate_count("filesystem path count", paths.len(), MAX_BATCH_PATHS)?;
    for path in paths {
        validate_path(path)?;
    }
    Ok(())
}

fn validate_path(path: &str) -> Result<()> {
    validate_string("filesystem path", path)
}

fn validate_string(label: &str, value: &str) -> Result<()> {
    if value.is_empty() || value.len() > MAX_PATH_BYTES {
        bail!("limit_exceeded: {label} must contain 1..={MAX_PATH_BYTES} bytes; reduce the value");
    }
    Ok(())
}

fn validate_count(label: &str, actual: usize, limit: usize) -> Result<()> {
    if actual > limit {
        bail!("limit_exceeded: {label} is {actual}, limit is {limit}; reduce the collection");
    }
    Ok(())
}

fn validate_bytes(label: &str, actual: usize, limit: usize) -> Result<()> {
    if actual > limit {
        bail!("limit_exceeded: {label} is {actual} bytes, limit is {limit}; reduce the payload");
    }
    Ok(())
}

fn validate_directory_output(entry_count: usize, encoded_name_bytes: usize) -> Result<()> {
    validate_count(
        "filesystem directory result entries",
        entry_count,
        MAX_DIRECTORY_ENTRIES,
    )?;
    validate_bytes(
        "filesystem directory result paths",
        encoded_name_bytes,
        MAX_DIRECTORY_RESULT_BYTES,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_and_collection_limits_are_bounded() {
        assert_eq!(
            transfer_limit(None).expect("default limit"),
            MAX_TRANSFER_BYTES
        );
        assert!(transfer_limit(Some(0)).is_err());
        assert!(transfer_limit(Some(MAX_TRANSFER_BYTES + 1)).is_err());
        assert!(validate_paths(&vec!["/a".into(); MAX_BATCH_PATHS]).is_ok());
        assert!(validate_paths(&vec!["/a".into(); MAX_BATCH_PATHS + 1]).is_err());
    }

    #[test]
    fn byte_content_uses_a_cbor_byte_string() {
        let mut encoded = Vec::new();
        ciborium::into_writer(&FileBytes(vec![1, 2, 3]), &mut encoded).expect("encode bytes");
        assert_eq!(encoded, vec![0x43, 1, 2, 3]);
    }
}
