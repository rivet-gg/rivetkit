use std::collections::BTreeMap;
use std::fmt;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use once_cell::sync::OnceCell;
use reqwest::header::{ACCEPT_ENCODING, LOCATION};
use reqwest::{redirect, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, Notify, Semaphore};

use crate::ClientError;

pub const DEFAULT_MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
pub const DEFAULT_PACKAGE_DOWNLOAD_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_PACKAGE_CONNECT_TIMEOUT_MS: u64 = 5_000;
pub const DEFAULT_PACKAGE_REDIRECT_LIMIT: usize = 3;
pub const DEFAULT_PACKAGE_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const DEFAULT_PACKAGE_CACHE_MAX_ENTRIES: usize = 256;
pub const DEFAULT_PACKAGE_CACHE_MAX_CONCURRENT_ACQUISITIONS: usize = 8;
pub const DEFAULT_PACKAGE_CACHE_MAX_PENDING_ACQUISITIONS: usize = 64;
pub const DEFAULT_PACKAGE_CACHE_ACQUISITION_TIMEOUT_MS: u64 = 60_000;
pub const DEFAULT_PACKAGE_CACHE_MAX_SOURCE_ENTRIES: usize = 1024;
pub const DEFAULT_PACKAGE_CACHE_SOURCE_TTL_MS: u64 = 60_000;
const MAX_PACKAGE_URL_BYTES: usize = 4 * 1024;
const MAX_PACKAGE_RESPONSE_HEADERS: usize = 128;
const MAX_PACKAGE_RESPONSE_HEADER_BYTES: usize = 64 * 1024;
const MAX_PACKAGE_MANIFEST_BYTES: usize = 1024 * 1024;
const MAX_PACKAGE_INDEX_BYTES: usize = 64 * 1024 * 1024;
const MAX_PACKAGE_NAME_BYTES: usize = 128;
const MAX_PACKAGE_VERSION_BYTES: usize = 128;
const MAX_PACKAGE_COMMANDS: usize = 1024;
const MAX_PACKAGE_COMMAND_BYTES: usize = 255;
const MAX_PACKAGE_ENTRY_BYTES: usize = 4 * 1024;
const MAX_PACKAGE_PROVIDES_ENV: usize = 1024;
const MAX_PACKAGE_PROVIDES_FILES: usize = 1024;
const DOWNLOAD_CHUNK_BYTES: usize = 64 * 1024;

static PROCESS_PACKAGE_CACHE: OnceCell<Arc<ProcessPackageCache>> = OnceCell::new();

/// Operator-owned limits for the one package cache shared by all Core clients
/// in this process. Hosted actor inputs cannot override these values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessPackageCacheOptions {
    pub max_bytes: u64,
    pub max_entries: usize,
    pub max_concurrent_acquisitions: usize,
    pub max_pending_acquisitions: usize,
    pub acquisition_timeout_ms: u64,
    pub max_source_entries: usize,
    pub source_ttl_ms: u64,
}

impl Default for ProcessPackageCacheOptions {
    fn default() -> Self {
        Self {
            max_bytes: DEFAULT_PACKAGE_CACHE_MAX_BYTES,
            max_entries: DEFAULT_PACKAGE_CACHE_MAX_ENTRIES,
            max_concurrent_acquisitions: DEFAULT_PACKAGE_CACHE_MAX_CONCURRENT_ACQUISITIONS,
            max_pending_acquisitions: DEFAULT_PACKAGE_CACHE_MAX_PENDING_ACQUISITIONS,
            acquisition_timeout_ms: DEFAULT_PACKAGE_CACHE_ACQUISITION_TIMEOUT_MS,
            max_source_entries: DEFAULT_PACKAGE_CACHE_MAX_SOURCE_ENTRIES,
            source_ttl_ms: DEFAULT_PACKAGE_CACHE_SOURCE_TTL_MS,
        }
    }
}

impl ProcessPackageCacheOptions {
    pub fn validate(&self) -> Result<(), ClientError> {
        if self.max_bytes == 0
            || self.max_entries == 0
            || self.max_concurrent_acquisitions == 0
            || self.max_pending_acquisitions == 0
            || self.acquisition_timeout_ms == 0
            || self.max_source_entries == 0
            || self.source_ttl_ms == 0
        {
            return Err(ClientError::PackageCacheConfiguration(String::from(
                "package cache byte, entry, source-index, concurrent acquisition, pending acquisition, and timeout limits must be greater than zero",
            )));
        }
        if self.max_pending_acquisitions < self.max_concurrent_acquisitions {
            return Err(ClientError::PackageCacheConfiguration(String::from(
                "max_pending_acquisitions must be at least max_concurrent_acquisitions",
            )));
        }
        Ok(())
    }
}

/// A bounded snapshot of process-cache state. Counters saturate instead of
/// wrapping; package identities are deliberately not exposed as metric labels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPackageCacheStats {
    pub entries: usize,
    pub source_entries: usize,
    pub bytes: u64,
    pub pinned_entries: usize,
    pub pending_acquisitions: usize,
    pub hits: u64,
    pub misses: u64,
    pub coalesced_waiters: u64,
    pub acquisitions: u64,
    pub evictions: u64,
    pub capacity_failures: u64,
}

/// Configure the process cache before constructing a [`PackageResolver`]. A
/// repeated identical call is idempotent; a different second configuration is
/// rejected so actors cannot silently change process-wide limits.
pub fn configure_process_package_cache(
    options: ProcessPackageCacheOptions,
) -> Result<(), ClientError> {
    options.validate()?;
    if let Some(cache) = PROCESS_PACKAGE_CACHE.get() {
        if cache.options == options {
            return Ok(());
        }
        return Err(ClientError::PackageCacheConfiguration(format!(
            "existing options are {:?}, requested options are {options:?}",
            cache.options
        )));
    }
    let cache = Arc::new(ProcessPackageCache::new(options.clone())?);
    match PROCESS_PACKAGE_CACHE.set(cache) {
        Ok(()) => Ok(()),
        Err(_) => configure_process_package_cache(options),
    }
}

fn process_package_cache() -> Result<Arc<ProcessPackageCache>, ClientError> {
    if PROCESS_PACKAGE_CACHE.get().is_none() {
        configure_process_package_cache(ProcessPackageCacheOptions::default())?;
    }
    PROCESS_PACKAGE_CACHE.get().cloned().ok_or_else(|| {
        ClientError::PackageCacheConfiguration(String::from(
            "process package cache initialization did not publish a cache",
        ))
    })
}

pub async fn process_package_cache_stats() -> Result<ProcessPackageCacheStats, ClientError> {
    Ok(process_package_cache()?.stats().await)
}

/// Trusted Core package locator. Hosted adapters must define their own URL-only
/// DTO rather than deserializing this enum directly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageSource {
    Url {
        url: String,
        expected_digest: Option<String>,
    },
    Path {
        path: String,
        expected_digest: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageResolverOptions {
    pub max_package_bytes: u64,
    pub download_timeout_ms: u64,
    pub connect_timeout_ms: u64,
    pub max_redirects: usize,
    /// Enables plain HTTP only for loopback destinations. This is intended for
    /// local integration tests and is never accepted from the hosted actor.
    pub allow_insecure_local_http: bool,
}

impl Default for PackageResolverOptions {
    fn default() -> Self {
        Self {
            max_package_bytes: DEFAULT_MAX_PACKAGE_BYTES,
            download_timeout_ms: DEFAULT_PACKAGE_DOWNLOAD_TIMEOUT_MS,
            connect_timeout_ms: DEFAULT_PACKAGE_CONNECT_TIMEOUT_MS,
            max_redirects: DEFAULT_PACKAGE_REDIRECT_LIMIT,
            allow_insecure_local_http: false,
        }
    }
}

impl PackageResolverOptions {
    pub(crate) fn validate(&self) -> Result<(), ClientError> {
        if self.max_package_bytes == 0 {
            return Err(ClientError::InvalidPackageSource(String::from(
                "max_package_bytes must be greater than zero",
            )));
        }
        if self.download_timeout_ms == 0 || self.connect_timeout_ms == 0 {
            return Err(ClientError::InvalidPackageSource(String::from(
                "package download and connect timeouts must be greater than zero",
            )));
        }
        if self.max_redirects > 16 {
            return Err(ClientError::InvalidPackageSource(String::from(
                "max_redirects exceeds limit of 16; reduce the redirect limit",
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageManifestInfo {
    pub name: String,
    pub version: String,
    pub commands: Vec<String>,
}

#[derive(Clone)]
pub struct VerifiedPackage {
    pub package_id: String,
    pub digest: String,
    pub size: u64,
    pub manifest: PackageManifestInfo,
    backing: Arc<PackageBacking>,
}

impl fmt::Debug for VerifiedPackage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VerifiedPackage")
            .field("package_id", &self.package_id)
            .field("digest", &self.digest)
            .field("size", &self.size)
            .field("manifest", &self.manifest)
            .finish_non_exhaustive()
    }
}

impl VerifiedPackage {
    /// Trusted embedded-Core access to the verified immutable artifact. Hosted
    /// actor DTOs never expose this path.
    pub fn path(&self) -> &Path {
        match self.backing.as_ref() {
            PackageBacking::Owned(path) => path.as_ref(),
            PackageBacking::Borrowed(path) => path,
            PackageBacking::Cached(artifact) => &artifact.path,
        }
    }
}

enum PackageBacking {
    Owned(tempfile::TempPath),
    Borrowed(PathBuf),
    Cached(Arc<CachedPackageArtifact>),
}

struct CachedPackageArtifact {
    path: PathBuf,
    package_id: String,
    digest: String,
    size: u64,
    manifest: PackageManifestInfo,
}

struct CachedPackageEntry {
    artifact: Arc<CachedPackageArtifact>,
    last_access: u64,
}

struct CachedSourceEntry {
    digest: String,
    resolved_at: std::time::Instant,
    last_access: u64,
}

struct PackageAcquisitionFlight {
    result: Mutex<Option<Result<VerifiedPackage, ClientError>>>,
    ready: Notify,
}

impl PackageAcquisitionFlight {
    fn new() -> Self {
        Self {
            result: Mutex::new(None),
            ready: Notify::new(),
        }
    }

    async fn wait(&self) -> Result<VerifiedPackage, ClientError> {
        loop {
            let notified = self.ready.notified();
            if let Some(result) = self.result.lock().await.clone() {
                return result;
            }
            notified.await;
        }
    }

    async fn finish(&self, result: Result<VerifiedPackage, ClientError>) {
        *self.result.lock().await = Some(result);
        self.ready.notify_waiters();
    }
}

struct ProcessPackageCacheState {
    entries: BTreeMap<String, CachedPackageEntry>,
    source_index: BTreeMap<String, CachedSourceEntry>,
    flights: BTreeMap<String, Arc<PackageAcquisitionFlight>>,
    bytes: u64,
    access_clock: u64,
    hits: u64,
    misses: u64,
    coalesced_waiters: u64,
    acquisitions: u64,
    evictions: u64,
    capacity_failures: u64,
}

struct ProcessPackageCache {
    options: ProcessPackageCacheOptions,
    root: tempfile::TempDir,
    acquisition_slots: Arc<Semaphore>,
    state: Mutex<ProcessPackageCacheState>,
}

impl ProcessPackageCache {
    fn new(options: ProcessPackageCacheOptions) -> Result<Self, ClientError> {
        options.validate()?;
        let root = tempfile::Builder::new()
            .prefix("agentos-process-package-cache-")
            .tempdir()
            .map_err(|error| {
                ClientError::PackageIo(format!("create process package cache: {error}"))
            })?;
        Ok(Self {
            acquisition_slots: Arc::new(Semaphore::new(options.max_concurrent_acquisitions)),
            options,
            root,
            state: Mutex::new(ProcessPackageCacheState {
                entries: BTreeMap::new(),
                source_index: BTreeMap::new(),
                flights: BTreeMap::new(),
                bytes: 0,
                access_clock: 0,
                hits: 0,
                misses: 0,
                coalesced_waiters: 0,
                acquisitions: 0,
                evictions: 0,
                capacity_failures: 0,
            }),
        })
    }

    async fn get(self: &Arc<Self>, digest: &str) -> Option<VerifiedPackage> {
        let mut state = self.state.lock().await;
        let artifact = state
            .entries
            .get(digest)
            .map(|entry| Arc::clone(&entry.artifact))?;
        state.access_clock = state.access_clock.saturating_add(1);
        let access = state.access_clock;
        if let Some(entry) = state.entries.get_mut(digest) {
            entry.last_access = access;
        }
        state.hits = state.hits.saturating_add(1);
        Some(cached_verified_package(artifact))
    }

    async fn get_source(self: &Arc<Self>, source_key: &str) -> Option<VerifiedPackage> {
        let mut state = self.state.lock().await;
        let (digest, expired) = state.source_index.get(source_key).map(|entry| {
            (
                entry.digest.clone(),
                entry.resolved_at.elapsed() > Duration::from_millis(self.options.source_ttl_ms),
            )
        })?;
        if expired {
            state.source_index.remove(source_key);
            return None;
        }
        let Some(artifact) = state
            .entries
            .get(&digest)
            .map(|entry| Arc::clone(&entry.artifact))
        else {
            state.source_index.remove(source_key);
            return None;
        };
        state.access_clock = state.access_clock.saturating_add(1);
        let access = state.access_clock;
        if let Some(entry) = state.entries.get_mut(&digest) {
            entry.last_access = access;
        }
        if let Some(entry) = state.source_index.get_mut(source_key) {
            entry.last_access = access;
        }
        state.hits = state.hits.saturating_add(1);
        Some(cached_verified_package(artifact))
    }

    async fn record_source(&self, source_key: String, digest: String) {
        let mut state = self.state.lock().await;
        if !state.entries.contains_key(&digest) {
            return;
        }
        state.access_clock = state.access_clock.saturating_add(1);
        let access = state.access_clock;
        if !state.source_index.contains_key(&source_key)
            && state.source_index.len() >= self.options.max_source_entries
        {
            if let Some(oldest) = state
                .source_index
                .iter()
                .min_by_key(|(_, entry)| entry.last_access)
                .map(|(source, _)| source.clone())
            {
                state.source_index.remove(&oldest);
            }
        }
        state.source_index.insert(
            source_key,
            CachedSourceEntry {
                digest,
                resolved_at: std::time::Instant::now(),
                last_access: access,
            },
        );
        if state.source_index.len() * 100 / self.options.max_source_entries >= 80 {
            tracing::warn!(
                limit = "process_package_cache_source_entries",
                observed = state.source_index.len(),
                capacity = self.options.max_source_entries,
                configuration_path = "ProcessPackageCacheOptions.max_source_entries",
                "process package cache source index approaching configured limit"
            );
        }
    }

    async fn get_or_acquire<F>(
        self: &Arc<Self>,
        flight_key: String,
        expected_digest: Option<&str>,
        acquisition: F,
    ) -> Result<VerifiedPackage, ClientError>
    where
        F: std::future::Future<Output = Result<VerifiedPackage, ClientError>> + Send + 'static,
    {
        if let Some(digest) = expected_digest {
            if let Some(package) = self.get(digest).await {
                return Ok(package);
            }
        } else if let Some(package) = self.get_source(&flight_key).await {
            return Ok(package);
        }

        let (flight, leader) = {
            let mut state = self.state.lock().await;
            state.misses = state.misses.saturating_add(1);
            if let Some(flight) = state.flights.get(&flight_key).cloned() {
                state.coalesced_waiters = state.coalesced_waiters.saturating_add(1);
                (flight, false)
            } else {
                if state.flights.len() >= self.options.max_pending_acquisitions {
                    return Err(ClientError::PackageCachePendingLimit {
                        limit: self.options.max_pending_acquisitions,
                    });
                }
                let flight = Arc::new(PackageAcquisitionFlight::new());
                state.flights.insert(flight_key.clone(), flight.clone());
                if state.flights.len() * 100 / self.options.max_pending_acquisitions >= 80 {
                    tracing::warn!(
                        limit = "process_package_cache_pending_acquisitions",
                        observed = state.flights.len(),
                        capacity = self.options.max_pending_acquisitions,
                        configuration_path = "ProcessPackageCacheOptions.max_pending_acquisitions",
                        "process package cache pending acquisitions approaching configured limit"
                    );
                }
                (flight, true)
            }
        };

        if leader {
            let cache = Arc::clone(self);
            let completion = Arc::clone(&flight);
            let record_source = expected_digest.is_none();
            tokio::spawn(async move {
                let result = tokio::time::timeout(
                    Duration::from_millis(cache.options.acquisition_timeout_ms),
                    cache.run_acquisition(acquisition),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(ClientError::PackageDownload(format!(
                        "package cache acquisition exceeded {}ms; raise ProcessPackageCacheOptions.acquisition_timeout_ms",
                        cache.options.acquisition_timeout_ms
                    )))
                });
                if record_source {
                    if let Ok(package) = &result {
                        cache
                            .record_source(flight_key.clone(), package.digest.clone())
                            .await;
                    }
                }
                {
                    let mut state = cache.state.lock().await;
                    if state
                        .flights
                        .get(&flight_key)
                        .is_some_and(|registered| Arc::ptr_eq(registered, &completion))
                    {
                        state.flights.remove(&flight_key);
                    }
                }
                completion.finish(result).await;
            });
        } else {
            drop(acquisition);
        }
        flight.wait().await
    }

    async fn run_acquisition<F>(
        self: &Arc<Self>,
        acquisition: F,
    ) -> Result<VerifiedPackage, ClientError>
    where
        F: std::future::Future<Output = Result<VerifiedPackage, ClientError>> + Send + 'static,
    {
        let _permit = Arc::clone(&self.acquisition_slots)
            .acquire_owned()
            .await
            .map_err(|_| {
                ClientError::PackageCacheConfiguration(String::from(
                    "process package cache acquisition semaphore closed",
                ))
            })?;
        {
            let mut state = self.state.lock().await;
            state.acquisitions = state.acquisitions.saturating_add(1);
        }
        let package = acquisition.await?;
        self.insert(package).await
    }

    async fn insert(
        self: &Arc<Self>,
        package: VerifiedPackage,
    ) -> Result<VerifiedPackage, ClientError> {
        {
            let mut state = self.state.lock().await;
            if let Some(entry) = state.entries.get(&package.digest) {
                return Ok(cached_verified_package(Arc::clone(&entry.artifact)));
            }
            if package.size > self.options.max_bytes {
                state.capacity_failures = state.capacity_failures.saturating_add(1);
                return Err(ClientError::PackageCacheCapacity {
                    requested: package.size,
                    current: state.bytes,
                    limit: self.options.max_bytes,
                });
            }
        }

        let staged = stage_cached_package(
            package.path().to_path_buf(),
            self.root.path().to_path_buf(),
            package.size,
            package.digest.clone(),
        )
        .await?;
        let mut state = self.state.lock().await;
        if let Some(entry) = state.entries.get(&package.digest) {
            return Ok(cached_verified_package(Arc::clone(&entry.artifact)));
        }
        self.evict_for_insert(&mut state, package.size)?;

        let digest_hex = package.digest.strip_prefix("sha256:").ok_or_else(|| {
            ClientError::PackageCacheConfiguration(String::from(
                "verified package digest lost its sha256 prefix",
            ))
        })?;
        let path = self.root.path().join(format!("{digest_hex}.aospkg"));
        staged.persist_noclobber(&path).map_err(|error| {
            ClientError::PackageIo(format!("publish immutable cached package: {error}"))
        })?;
        let mut permissions = match std::fs::metadata(&path) {
            Ok(metadata) => metadata.permissions(),
            Err(error) => {
                remove_failed_cache_publication(&path, "metadata failure");
                return Err(ClientError::PackageIo(format!(
                    "stat cached package: {error}"
                )));
            }
        };
        permissions.set_readonly(true);
        if let Err(error) = std::fs::set_permissions(&path, permissions) {
            remove_failed_cache_publication(&path, "permission failure");
            return Err(ClientError::PackageIo(format!(
                "make cached package immutable: {error}"
            )));
        }
        let artifact = Arc::new(CachedPackageArtifact {
            path,
            package_id: package.package_id,
            digest: package.digest.clone(),
            size: package.size,
            manifest: package.manifest,
        });
        state.access_clock = state.access_clock.saturating_add(1);
        let access = state.access_clock;
        state.bytes = state.bytes.saturating_add(artifact.size);
        state.entries.insert(
            artifact.digest.clone(),
            CachedPackageEntry {
                artifact: Arc::clone(&artifact),
                last_access: access,
            },
        );
        if state.bytes.saturating_mul(100) / self.options.max_bytes >= 80
            || state.entries.len() * 100 / self.options.max_entries >= 80
        {
            tracing::warn!(
                limit = "process_package_cache_capacity",
                observed_bytes = state.bytes,
                capacity_bytes = self.options.max_bytes,
                observed_entries = state.entries.len(),
                capacity_entries = self.options.max_entries,
                configuration_path = "ProcessPackageCacheOptions",
                "process package cache approaching configured capacity"
            );
        }
        Ok(cached_verified_package(artifact))
    }

    fn evict_for_insert(
        &self,
        state: &mut ProcessPackageCacheState,
        requested: u64,
    ) -> Result<(), ClientError> {
        while state.entries.len() >= self.options.max_entries
            || state.bytes.saturating_add(requested) > self.options.max_bytes
        {
            let victim = state
                .entries
                .iter()
                .filter(|(_, entry)| Arc::strong_count(&entry.artifact) == 1)
                .min_by_key(|(_, entry)| entry.last_access)
                .map(|(digest, _)| digest.clone());
            let Some(victim) = victim else {
                state.capacity_failures = state.capacity_failures.saturating_add(1);
                if state.entries.len() >= self.options.max_entries {
                    return Err(ClientError::PackageCacheEntryCapacity {
                        current: state.entries.len(),
                        limit: self.options.max_entries,
                    });
                }
                return Err(ClientError::PackageCacheCapacity {
                    requested,
                    current: state.bytes,
                    limit: self.options.max_bytes,
                });
            };
            let entry = state
                .entries
                .remove(&victim)
                .expect("selected package cache victim must remain registered");
            if let Err(error) = std::fs::remove_file(&entry.artifact.path) {
                state.entries.insert(victim, entry);
                return Err(ClientError::PackageIo(format!(
                    "evict cached package: {error}"
                )));
            }
            state.bytes = state.bytes.saturating_sub(entry.artifact.size);
            state
                .source_index
                .retain(|_, source| source.digest != victim);
            state.evictions = state.evictions.saturating_add(1);
        }
        Ok(())
    }

    async fn stats(&self) -> ProcessPackageCacheStats {
        let state = self.state.lock().await;
        ProcessPackageCacheStats {
            entries: state.entries.len(),
            source_entries: state.source_index.len(),
            bytes: state.bytes,
            pinned_entries: state
                .entries
                .values()
                .filter(|entry| Arc::strong_count(&entry.artifact) > 1)
                .count(),
            pending_acquisitions: state.flights.len(),
            hits: state.hits,
            misses: state.misses,
            coalesced_waiters: state.coalesced_waiters,
            acquisitions: state.acquisitions,
            evictions: state.evictions,
            capacity_failures: state.capacity_failures,
        }
    }
}

fn remove_failed_cache_publication(path: &Path, failure: &'static str) {
    if let Err(cleanup_error) = std::fs::remove_file(path) {
        tracing::error!(
            %cleanup_error,
            cache_path = %path.display(),
            %failure,
            "failed to remove unsuccessfully published cached package"
        );
    }
}

fn cached_verified_package(artifact: Arc<CachedPackageArtifact>) -> VerifiedPackage {
    VerifiedPackage {
        package_id: artifact.package_id.clone(),
        digest: artifact.digest.clone(),
        size: artifact.size,
        manifest: artifact.manifest.clone(),
        backing: Arc::new(PackageBacking::Cached(artifact)),
    }
}

async fn stage_cached_package(
    source: PathBuf,
    root: PathBuf,
    expected_size: u64,
    expected_digest: String,
) -> Result<tempfile::TempPath, ClientError> {
    tokio::task::spawn_blocking(move || {
        let mut source = std::fs::File::open(&source)
            .map_err(|error| ClientError::PackageIo(format!("open verified package: {error}")))?;
        let mut staged = tempfile::Builder::new()
            .prefix(".package-staging-")
            .tempfile_in(root)
            .map_err(|error| {
                ClientError::PackageIo(format!("create package cache staging file: {error}"))
            })?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; DOWNLOAD_CHUNK_BYTES];
        let mut copied = 0u64;
        loop {
            let count = source.read(&mut buffer).map_err(|error| {
                ClientError::PackageIo(format!("read verified package for cache: {error}"))
            })?;
            if count == 0 {
                break;
            }
            staged.as_file_mut().write_all(&buffer[..count]).map_err(|error| {
                ClientError::PackageIo(format!("copy package into process cache: {error}"))
            })?;
            hasher.update(&buffer[..count]);
            copied = copied.saturating_add(count as u64);
        }
        if copied != expected_size {
            return Err(ClientError::PackageIo(format!(
                "verified package changed while caching: expected {expected_size} bytes, copied {copied}"
            )));
        }
        let copied_digest = format!("sha256:{}", hex_digest(hasher.finalize().as_slice()));
        if copied_digest != expected_digest {
            return Err(ClientError::PackageDigestMismatch {
                expected: expected_digest,
                actual: copied_digest,
            });
        }
        staged.as_file().sync_all().map_err(|error| {
            ClientError::PackageIo(format!("sync package cache staging file: {error}"))
        })?;
        Ok(staged.into_temp_path())
    })
    .await
    .map_err(|error| ClientError::PackageIo(format!("package cache task failed: {error}")))?
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSoftware {
    pub package_id: String,
    pub digest: String,
    pub size: u64,
    pub package_name: String,
    pub version: String,
    pub commands: Vec<String>,
}

impl From<&VerifiedPackage> for InstalledSoftware {
    fn from(package: &VerifiedPackage) -> Self {
        Self {
            package_id: package.package_id.clone(),
            digest: package.digest.clone(),
            size: package.size,
            package_name: package.manifest.name.clone(),
            version: package.manifest.version.clone(),
            commands: package.manifest.commands.clone(),
        }
    }
}

#[derive(Clone)]
pub struct PackageResolver {
    options: PackageResolverOptions,
    cache: Arc<ProcessPackageCache>,
}

impl PackageResolver {
    pub fn new(options: PackageResolverOptions) -> Result<Self, ClientError> {
        options.validate()?;
        Ok(Self {
            options,
            cache: process_package_cache()?,
        })
    }

    pub async fn resolve(&self, source: PackageSource) -> Result<VerifiedPackage, ClientError> {
        self.validate_source(&source)?;
        let expected_digest = match &source {
            PackageSource::Url {
                expected_digest, ..
            }
            | PackageSource::Path {
                expected_digest, ..
            } => normalize_expected_digest(expected_digest.as_deref())?,
        };
        let flight_key = if let Some(digest) = &expected_digest {
            format!("digest:{digest}")
        } else {
            match &source {
                PackageSource::Url { url, .. } => {
                    format!("url:{}", parse_package_url(url)?.as_str())
                }
                PackageSource::Path { path, .. } => format!("path:{path}"),
            }
        };
        let resolver = self.clone();
        let package = self
            .cache
            .get_or_acquire(flight_key, expected_digest.as_deref(), async move {
                resolver.resolve_uncached(source).await
            })
            .await?;
        enforce_package_size(package.size, self.options.max_package_bytes)?;
        Ok(package)
    }

    async fn resolve_uncached(
        &self,
        source: PackageSource,
    ) -> Result<VerifiedPackage, ClientError> {
        match source {
            PackageSource::Url {
                url,
                expected_digest,
            } => self.resolve_url(&url, expected_digest.as_deref()).await,
            PackageSource::Path {
                path,
                expected_digest,
            } => self.resolve_path(&path, expected_digest.as_deref()).await,
        }
    }

    pub async fn cache_stats(&self) -> ProcessPackageCacheStats {
        self.cache.stats().await
    }

    /// Validate source syntax and digest form without opening a path, resolving
    /// DNS, or starting a download.
    pub fn validate_source(&self, source: &PackageSource) -> Result<(), ClientError> {
        match source {
            PackageSource::Url {
                url,
                expected_digest,
            } => {
                parse_package_url(url)?;
                normalize_expected_digest(expected_digest.as_deref())?;
            }
            PackageSource::Path {
                path,
                expected_digest,
            } => {
                if path.is_empty() {
                    return Err(ClientError::InvalidPackageSource(String::from(
                        "package path cannot be empty",
                    )));
                }
                normalize_expected_digest(expected_digest.as_deref())?;
            }
        }
        Ok(())
    }

    async fn resolve_path(
        &self,
        source_path: &str,
        expected_digest: Option<&str>,
    ) -> Result<VerifiedPackage, ClientError> {
        if source_path.is_empty() {
            return Err(ClientError::InvalidPackageSource(String::from(
                "package path cannot be empty",
            )));
        }
        let path = tokio::fs::canonicalize(source_path)
            .await
            .map_err(|error| ClientError::PackageIo(format!("open package path: {error}")))?;
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|error| ClientError::PackageIo(format!("stat package path: {error}")))?;
        if !metadata.is_file() {
            return Err(ClientError::InvalidPackageSource(String::from(
                "package path must identify a regular .aospkg file",
            )));
        }
        enforce_package_size(metadata.len(), self.options.max_package_bytes)?;

        let digest = digest_file(&path, self.options.max_package_bytes).await?;
        verify_expected_digest(&digest, expected_digest)?;
        let manifest = validate_package_file(path.clone(), metadata.len()).await?;
        Ok(verified_package(
            digest,
            metadata.len(),
            manifest,
            PackageBacking::Borrowed(path),
        ))
    }

    async fn resolve_url(
        &self,
        raw_url: &str,
        expected_digest: Option<&str>,
    ) -> Result<VerifiedPackage, ClientError> {
        normalize_expected_digest(expected_digest)?;
        let mut url = parse_package_url(raw_url)?;
        let mut redirect_count = 0usize;

        let response = loop {
            let (client, label) = self.client_for_url(&url).await?;
            let response = client
                .get(url.clone())
                .header(ACCEPT_ENCODING, "identity")
                .send()
                .await
                .map_err(|error| package_request_error(&label, &error))?;
            enforce_response_header_limits(response.headers())?;

            if is_redirect(response.status()) {
                if redirect_count == self.options.max_redirects {
                    return Err(ClientError::PackageDownload(format!(
                        "package redirect limit {} reached at {label}; raise max_redirects",
                        self.options.max_redirects
                    )));
                }
                let location = response.headers().get(LOCATION).ok_or_else(|| {
                    ClientError::PackageDownload(format!(
                        "package redirect from {label} omitted Location"
                    ))
                })?;
                let location = location.to_str().map_err(|_| {
                    ClientError::PackageDownload(format!(
                        "package redirect from {label} has a non-text Location"
                    ))
                })?;
                url = url.join(location).map_err(|_| {
                    ClientError::PackageDownload(format!(
                        "package redirect from {label} has an invalid Location"
                    ))
                })?;
                validate_package_url_shape(&url)?;
                redirect_count += 1;
                continue;
            }
            if !response.status().is_success() {
                return Err(ClientError::PackageDownload(format!(
                    "package request to {label} returned HTTP {}",
                    response.status().as_u16()
                )));
            }
            if let Some(size) = response.content_length() {
                enforce_package_size(size, self.options.max_package_bytes)?;
            }
            break response;
        };

        let named = tempfile::Builder::new()
            .prefix("agentos-package-")
            .suffix(".aospkg")
            .tempfile()
            .map_err(|error| {
                ClientError::PackageIo(format!("create package staging file: {error}"))
            })?;
        let (file, temp_path) = named.into_parts();
        let mut file = tokio::fs::File::from_std(file);
        let mut stream = response.bytes_stream();
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                ClientError::PackageDownload(if error.is_timeout() {
                    String::from("package response timed out while reading the body")
                } else {
                    String::from("package response failed while reading the body")
                })
            })?;
            size = size
                .checked_add(chunk.len() as u64)
                .ok_or(ClientError::PackageTooLarge {
                    observed: u64::MAX,
                    limit: self.options.max_package_bytes,
                })?;
            enforce_package_size(size, self.options.max_package_bytes)?;
            hasher.update(&chunk);
            file.write_all(&chunk).await.map_err(|error| {
                ClientError::PackageIo(format!("write package staging file: {error}"))
            })?;
        }
        file.flush().await.map_err(|error| {
            ClientError::PackageIo(format!("flush package staging file: {error}"))
        })?;
        drop(file);

        let digest = format!("sha256:{}", hex_digest(hasher.finalize().as_slice()));
        verify_expected_digest(&digest, expected_digest)?;
        let manifest = validate_package_file(temp_path.to_path_buf(), size).await?;
        Ok(verified_package(
            digest,
            size,
            manifest,
            PackageBacking::Owned(temp_path),
        ))
    }

    async fn client_for_url(&self, url: &Url) -> Result<(reqwest::Client, String), ClientError> {
        validate_package_url_shape(url)?;
        let label = redacted_url(url);
        let host = url.host_str().ok_or_else(|| {
            ClientError::InvalidPackageSource(String::from("package URL must include a host"))
        })?;
        let port = url.port_or_known_default().ok_or_else(|| {
            ClientError::InvalidPackageSource(String::from("package URL has no usable port"))
        })?;
        let addresses = resolve_addresses(host, port, self.options.connect_timeout_ms).await?;
        let local_http = url.scheme() == "http";
        if local_http
            && (!self.options.allow_insecure_local_http
                || addresses.iter().any(|address| !address.ip().is_loopback()))
        {
            return Err(ClientError::InvalidPackageSource(String::from(
                "plain HTTP packages are allowed only for loopback addresses when allow_insecure_local_http is enabled",
            )));
        }
        if addresses.iter().any(|address| {
            !is_public_ip(address.ip())
                && !(self.options.allow_insecure_local_http && address.ip().is_loopback())
        }) {
            return Err(ClientError::InvalidPackageSource(format!(
                "package URL {label} resolves to a private or special-purpose address"
            )));
        }

        let mut builder = reqwest::Client::builder()
            .connect_timeout(Duration::from_millis(self.options.connect_timeout_ms))
            .timeout(Duration::from_millis(self.options.download_timeout_ms))
            .redirect(redirect::Policy::none())
            .no_proxy();
        if host.parse::<IpAddr>().is_err() {
            builder = builder.resolve_to_addrs(host, &addresses);
        }
        let client = builder.build().map_err(|_| {
            ClientError::PackageDownload(String::from("build isolated package HTTP client"))
        })?;
        Ok((client, label))
    }
}

fn verified_package(
    digest: String,
    size: u64,
    manifest: PackageManifestInfo,
    backing: PackageBacking,
) -> VerifiedPackage {
    VerifiedPackage {
        package_id: digest.clone(),
        digest,
        size,
        manifest,
        backing: Arc::new(backing),
    }
}

async fn digest_file(path: &Path, limit: u64) -> Result<String, ClientError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| ClientError::PackageIo(format!("open package file: {error}")))?;
    let mut buffer = vec![0u8; DOWNLOAD_CHUNK_BYTES];
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    loop {
        let count = file
            .read(&mut buffer)
            .await
            .map_err(|error| ClientError::PackageIo(format!("read package file: {error}")))?;
        if count == 0 {
            break;
        }
        size = size
            .checked_add(count as u64)
            .ok_or(ClientError::PackageTooLarge {
                observed: u64::MAX,
                limit,
            })?;
        enforce_package_size(size, limit)?;
        hasher.update(&buffer[..count]);
    }
    Ok(format!(
        "sha256:{}",
        hex_digest(hasher.finalize().as_slice())
    ))
}

async fn validate_package_file(
    path: PathBuf,
    size: u64,
) -> Result<PackageManifestInfo, ClientError> {
    tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::open(&path)
            .map_err(|error| ClientError::PackageIo(format!("open verified package: {error}")))?;
        let mut prefix = [0u8; vfs::package_format::AOSPKG_HEADER_LEN];
        file.read_exact(&mut prefix).map_err(|error| {
            ClientError::InvalidPackageFormat(format!("read .aospkg header: {error}"))
        })?;
        let size_usize = usize::try_from(size).map_err(|_| {
            ClientError::InvalidPackageFormat(String::from(
                ".aospkg size cannot be represented on this platform",
            ))
        })?;
        let header = vfs::package_format::parse_aospkg_header_from_prefix(&prefix, size_usize)
            .map_err(|error| ClientError::InvalidPackageFormat(error.to_string()))?;
        if header.manifest.len() > MAX_PACKAGE_MANIFEST_BYTES {
            return Err(ClientError::InvalidPackageFormat(format!(
                ".aospkg manifest is {} bytes; limit is {MAX_PACKAGE_MANIFEST_BYTES}",
                header.manifest.len()
            )));
        }
        if header.index.len() > MAX_PACKAGE_INDEX_BYTES {
            return Err(ClientError::InvalidPackageFormat(format!(
                ".aospkg mount index is {} bytes; limit is {MAX_PACKAGE_INDEX_BYTES}",
                header.index.len()
            )));
        }
        // Decode and validate the bounded mount index before immutable bytes
        // enter the shared cache. Projection reuses the same VFS parser and
        // mmap path, so cache hits cannot defer malformed-index failures until
        // a VM mutation.
        vfs::posix::TarFileSystem::open(&path)
            .map_err(|error| ClientError::InvalidPackageFormat(error.to_string()))?;
        let manifest = vfs::package_format::read_manifest_chunk_from_file(&path)
            .map_err(|error| ClientError::InvalidPackageFormat(error.to_string()))?;
        validate_manifest_component("name", &manifest.name, MAX_PACKAGE_NAME_BYTES)?;
        validate_manifest_component("version", &manifest.version, MAX_PACKAGE_VERSION_BYTES)?;
        if manifest.commands.len() > MAX_PACKAGE_COMMANDS {
            return Err(ClientError::InvalidPackageFormat(format!(
                "package manifest commands exceeds limit of {MAX_PACKAGE_COMMANDS}"
            )));
        }
        for command in &manifest.commands {
            validate_manifest_component("command", &command.command, MAX_PACKAGE_COMMAND_BYTES)?;
            validate_relative_manifest_path("command entry", &command.entry)?;
        }
        if let Some(provides) = &manifest.provides {
            if provides.env.len() > MAX_PACKAGE_PROVIDES_ENV {
                return Err(ClientError::InvalidPackageFormat(format!(
                    "package provides.env exceeds limit of {MAX_PACKAGE_PROVIDES_ENV}"
                )));
            }
            if provides.files.len() > MAX_PACKAGE_PROVIDES_FILES {
                return Err(ClientError::InvalidPackageFormat(format!(
                    "package provides.files exceeds limit of {MAX_PACKAGE_PROVIDES_FILES}"
                )));
            }
            for file in &provides.files {
                validate_relative_manifest_path("provided file source", &file.source)?;
                validate_absolute_manifest_path("provided file target", &file.target)?;
            }
        }
        Ok(PackageManifestInfo {
            name: manifest.name,
            version: manifest.version,
            commands: manifest
                .commands
                .into_iter()
                .map(|command| command.command)
                .collect(),
        })
    })
    .await
    .map_err(|error| ClientError::PackageIo(format!("package validation task failed: {error}")))?
}

fn validate_manifest_component(name: &str, value: &str, limit: usize) -> Result<(), ClientError> {
    if value.is_empty() || value.len() > limit {
        return Err(ClientError::InvalidPackageFormat(format!(
            "package manifest {name} must contain 1..={limit} bytes"
        )));
    }
    if value == "."
        || value == ".."
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@'))
    {
        return Err(ClientError::InvalidPackageFormat(format!(
            "package manifest {name} contains unsafe path characters"
        )));
    }
    Ok(())
}

fn validate_relative_manifest_path(name: &str, value: &str) -> Result<(), ClientError> {
    if value.is_empty() || value.len() > MAX_PACKAGE_ENTRY_BYTES || value.starts_with('/') {
        return Err(ClientError::InvalidPackageFormat(format!(
            "package manifest {name} must be a non-empty relative path of at most {MAX_PACKAGE_ENTRY_BYTES} bytes"
        )));
    }
    if value
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(ClientError::InvalidPackageFormat(format!(
            "package manifest {name} must be normalized and cannot traverse"
        )));
    }
    Ok(())
}

fn validate_absolute_manifest_path(name: &str, value: &str) -> Result<(), ClientError> {
    if value.is_empty()
        || value.len() > MAX_PACKAGE_ENTRY_BYTES
        || !value.starts_with('/')
        || value == "/"
        || value.ends_with('/')
    {
        return Err(ClientError::InvalidPackageFormat(format!(
            "package manifest {name} must be a normalized non-root absolute path of at most {MAX_PACKAGE_ENTRY_BYTES} bytes"
        )));
    }
    if value
        .split('/')
        .skip(1)
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(ClientError::InvalidPackageFormat(format!(
            "package manifest {name} must be normalized and cannot traverse"
        )));
    }
    Ok(())
}

fn parse_package_url(raw: &str) -> Result<Url, ClientError> {
    if raw.is_empty() || raw.len() > MAX_PACKAGE_URL_BYTES {
        return Err(ClientError::InvalidPackageSource(format!(
            "package URL must contain 1..={MAX_PACKAGE_URL_BYTES} bytes"
        )));
    }
    let url = Url::parse(raw)
        .map_err(|_| ClientError::InvalidPackageSource(String::from("package URL is invalid")))?;
    validate_package_url_shape(&url)?;
    Ok(url)
}

fn validate_package_url_shape(url: &Url) -> Result<(), ClientError> {
    if !matches!(url.scheme(), "https" | "http") {
        return Err(ClientError::InvalidPackageSource(String::from(
            "package URL scheme must be https (or loopback http under local-test policy)",
        )));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ClientError::InvalidPackageSource(String::from(
            "package URL must not contain userinfo",
        )));
    }
    if url.fragment().is_some() {
        return Err(ClientError::InvalidPackageSource(String::from(
            "package URL must not contain a fragment",
        )));
    }
    if url.host_str().is_none() {
        return Err(ClientError::InvalidPackageSource(String::from(
            "package URL must include a host",
        )));
    }
    Ok(())
}

async fn resolve_addresses(
    host: &str,
    port: u16,
    timeout_ms: u64,
) -> Result<Vec<SocketAddr>, ClientError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(vec![SocketAddr::new(ip, port)]);
    }
    let resolved = tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        tokio::net::lookup_host((host, port)),
    )
    .await
    .map_err(|_| ClientError::PackageDownload(String::from("package DNS lookup timed out")))?
    .map_err(|_| ClientError::PackageDownload(String::from("package DNS lookup failed")))?;
    let mut addresses = resolved.take(16).collect::<Vec<_>>();
    addresses.sort();
    addresses.dedup();
    if addresses.is_empty() {
        return Err(ClientError::PackageDownload(String::from(
            "package DNS lookup returned no addresses",
        )));
    }
    Ok(addresses)
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_ipv4(v4);
    }
    let segments = ip.segments();
    (segments[0] & 0xe000) == 0x2000 && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
}

fn is_redirect(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT
    )
}

fn enforce_package_size(size: u64, limit: u64) -> Result<(), ClientError> {
    if size > limit {
        return Err(ClientError::PackageTooLarge {
            observed: size,
            limit,
        });
    }
    Ok(())
}

fn enforce_response_header_limits(headers: &reqwest::header::HeaderMap) -> Result<(), ClientError> {
    if headers.len() > MAX_PACKAGE_RESPONSE_HEADERS {
        return Err(ClientError::PackageDownload(format!(
            "package response has {} headers; limit is {MAX_PACKAGE_RESPONSE_HEADERS}",
            headers.len()
        )));
    }
    let bytes = headers.iter().try_fold(0usize, |total, (name, value)| {
        total
            .checked_add(name.as_str().len())
            .and_then(|total| total.checked_add(value.as_bytes().len()))
    });
    if bytes.is_none_or(|bytes| bytes > MAX_PACKAGE_RESPONSE_HEADER_BYTES) {
        return Err(ClientError::PackageDownload(format!(
            "package response headers exceed {MAX_PACKAGE_RESPONSE_HEADER_BYTES} bytes"
        )));
    }
    Ok(())
}

fn verify_expected_digest(actual: &str, expected: Option<&str>) -> Result<(), ClientError> {
    let Some(expected) = normalize_expected_digest(expected)? else {
        return Ok(());
    };
    if expected != actual {
        return Err(ClientError::PackageDigestMismatch {
            expected,
            actual: actual.to_owned(),
        });
    }
    Ok(())
}

fn normalize_expected_digest(value: Option<&str>) -> Result<Option<String>, ClientError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let Some(hex) = value.strip_prefix("sha256:") else {
        return Err(ClientError::InvalidPackageSource(String::from(
            "package digest must use the sha256:<64 lowercase hex> form",
        )));
    };
    if hex.len() != 64
        || !hex.bytes().all(|byte| byte.is_ascii_hexdigit())
        || hex.bytes().any(|byte| byte.is_ascii_uppercase())
    {
        return Err(ClientError::InvalidPackageSource(String::from(
            "package digest must use the sha256:<64 lowercase hex> form",
        )));
    }
    Ok(Some(value.to_owned()))
}

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn redacted_url(url: &Url) -> String {
    let mut redacted = url.clone();
    redacted.set_query(url.query().map(|_| "<redacted>"));
    redacted.set_fragment(None);
    redacted.to_string()
}

fn package_request_error(label: &str, error: &reqwest::Error) -> ClientError {
    let reason = if error.is_timeout() {
        "timed out"
    } else if error.is_connect() {
        "failed to connect"
    } else if error.is_request() {
        "request failed"
    } else {
        "transport failed"
    };
    ClientError::PackageDownload(format!("package request to {label} {reason}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn test_package() -> Vec<u8> {
        test_package_with_version("1.0.0")
    }

    fn test_package_with_version(version: &str) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::<u8>::new());
        let manifest = format!(r#"{{"name":"demo","version":"{version}"}}"#);
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, "agentos-package.json", manifest.as_bytes())
            .unwrap();
        let command = b"#!/bin/sh\necho demo\n";
        let mut header = tar::Header::new_gnu();
        header.set_size(command.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, "bin/demo", &command[..])
            .unwrap();
        let tar = builder.into_inner().unwrap();
        vfs::package_format::pack::pack_aospkg_from_tar_bytes(&tar)
            .unwrap()
            .0
    }

    async fn uncached_package(path: PathBuf) -> Result<VerifiedPackage, ClientError> {
        let size = tokio::fs::metadata(&path)
            .await
            .map_err(|error| ClientError::PackageIo(error.to_string()))?
            .len();
        let digest = digest_file(&path, DEFAULT_MAX_PACKAGE_BYTES).await?;
        let manifest = validate_package_file(path.clone(), size).await?;
        Ok(verified_package(
            digest,
            size,
            manifest,
            PackageBacking::Borrowed(path),
        ))
    }

    fn test_cache_options() -> ProcessPackageCacheOptions {
        ProcessPackageCacheOptions {
            max_bytes: 16 * 1024 * 1024,
            max_entries: 8,
            max_concurrent_acquisitions: 2,
            max_pending_acquisitions: 128,
            acquisition_timeout_ms: 5_000,
            max_source_entries: 32,
            source_ttl_ms: 5_000,
        }
    }

    #[test]
    fn digest_form_is_strict() {
        let valid = format!("sha256:{}", "a".repeat(64));
        assert_eq!(
            normalize_expected_digest(Some(&valid)).unwrap(),
            Some(valid)
        );
        for invalid in ["abc", "sha256:ABC", "sha256:00"] {
            assert!(normalize_expected_digest(Some(invalid)).is_err());
        }
    }

    #[test]
    fn url_shape_rejects_ambient_credentials_and_non_http_schemes() {
        for invalid in [
            "file:///tmp/package.aospkg",
            "https://user:secret@example.com/package.aospkg",
            "https://example.com/package.aospkg#fragment",
        ] {
            assert!(parse_package_url(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn special_addresses_are_not_public() {
        for private in ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fc00::1"] {
            assert!(
                !is_public_ip(private.parse().unwrap()),
                "accepted {private}"
            );
        }
        for public in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(is_public_ip(public.parse().unwrap()), "rejected {public}");
        }
    }

    #[test]
    fn url_redaction_removes_query_values() {
        let url = Url::parse("https://example.com/a?token=secret&x=1").unwrap();
        let redacted = redacted_url(&url);
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("%3Credacted%3E"));
    }

    #[tokio::test]
    async fn path_and_loopback_url_resolve_to_the_same_identity() {
        let bytes = test_package();
        let package = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(package.path(), &bytes).unwrap();
        let path_resolver = PackageResolver::new(PackageResolverOptions::default()).unwrap();
        let from_path = path_resolver
            .resolve(PackageSource::Path {
                path: package.path().to_string_lossy().into_owned(),
                expected_digest: None,
            })
            .await
            .unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server_bytes = bytes.clone();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request).await.unwrap();
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                server_bytes.len()
            );
            stream.write_all(headers.as_bytes()).await.unwrap();
            stream.write_all(&server_bytes).await.unwrap();
        });
        let url_resolver = PackageResolver::new(PackageResolverOptions {
            allow_insecure_local_http: true,
            ..PackageResolverOptions::default()
        })
        .unwrap();
        let from_url = url_resolver
            .resolve(PackageSource::Url {
                url: format!("http://{address}/demo.aospkg"),
                expected_digest: None,
            })
            .await
            .unwrap();
        server.await.unwrap();

        assert_eq!(from_url.package_id, from_path.package_id);
        assert_eq!(from_url.size, from_path.size);
        assert_eq!(from_url.manifest, from_path.manifest);
        assert_eq!(from_url.manifest.commands, vec!["demo"]);
    }

    #[tokio::test]
    async fn digest_mismatch_is_typed() {
        let package = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(package.path(), test_package()).unwrap();
        let resolver = PackageResolver::new(PackageResolverOptions::default()).unwrap();
        let error = resolver
            .resolve(PackageSource::Path {
                path: package.path().to_string_lossy().into_owned(),
                expected_digest: Some(format!("sha256:{}", "0".repeat(64))),
            })
            .await
            .expect_err("digest mismatch must fail");
        assert!(matches!(error, ClientError::PackageDigestMismatch { .. }));
    }

    #[tokio::test]
    async fn concurrent_same_source_uses_one_acquisition() {
        const CALLERS: usize = 100;
        let package = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(package.path(), test_package()).unwrap();
        let package_path = package.path().to_path_buf();
        let cache = Arc::new(ProcessPackageCache::new(test_cache_options()).unwrap());
        let start = Arc::new(tokio::sync::Barrier::new(CALLERS + 1));
        let acquisition_gate = Arc::new(Semaphore::new(0));
        let acquisitions = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::with_capacity(CALLERS);
        for _ in 0..CALLERS {
            let cache = Arc::clone(&cache);
            let start = Arc::clone(&start);
            let gate = Arc::clone(&acquisition_gate);
            let acquisitions = Arc::clone(&acquisitions);
            let path = package_path.clone();
            tasks.push(tokio::spawn(async move {
                start.wait().await;
                cache
                    .get_or_acquire(
                        String::from("url:https://example.test/demo"),
                        None,
                        async move {
                            acquisitions.fetch_add(1, Ordering::SeqCst);
                            gate.acquire_owned()
                                .await
                                .expect("test acquisition gate")
                                .forget();
                            uncached_package(path).await
                        },
                    )
                    .await
            }));
        }
        start.wait().await;
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if cache.stats().await.coalesced_waiters == (CALLERS - 1) as u64 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("all callers join one flight");
        acquisition_gate.add_permits(1);

        let mut resolved = Vec::with_capacity(CALLERS);
        for task in tasks {
            resolved.push(task.await.unwrap().unwrap());
        }
        assert_eq!(acquisitions.load(Ordering::SeqCst), 1);
        assert!(resolved
            .iter()
            .all(|package| package.digest == resolved[0].digest));
        let stats = cache.stats().await;
        assert_eq!(stats.acquisitions, 1);
        assert_eq!(stats.coalesced_waiters, (CALLERS - 1) as u64);
        assert_eq!(stats.entries, 1);
        assert_eq!(stats.pinned_entries, 1);
    }

    #[tokio::test]
    async fn recent_source_resolution_reuses_the_digest_entry() {
        let package = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(package.path(), test_package()).unwrap();
        let cache = Arc::new(ProcessPackageCache::new(test_cache_options()).unwrap());
        let acquisitions = Arc::new(AtomicUsize::new(0));
        let source_key = String::from("url:https://example.test/demo");

        let first_count = Arc::clone(&acquisitions);
        let first_path = package.path().to_path_buf();
        let first = cache
            .get_or_acquire(source_key.clone(), None, async move {
                first_count.fetch_add(1, Ordering::SeqCst);
                uncached_package(first_path).await
            })
            .await
            .unwrap();
        let second_count = Arc::clone(&acquisitions);
        let second_path = package.path().to_path_buf();
        let second = cache
            .get_or_acquire(source_key, None, async move {
                second_count.fetch_add(1, Ordering::SeqCst);
                uncached_package(second_path).await
            })
            .await
            .unwrap();

        assert_eq!(first.digest, second.digest);
        assert_eq!(acquisitions.load(Ordering::SeqCst), 1);
        let stats = cache.stats().await;
        assert_eq!(stats.source_entries, 1);
        assert_eq!(stats.hits, 1);
    }

    #[tokio::test]
    async fn failed_flight_is_removed_before_retry() {
        let package = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(package.path(), test_package()).unwrap();
        let cache = Arc::new(ProcessPackageCache::new(test_cache_options()).unwrap());

        let error = cache
            .get_or_acquire(String::from("failure"), None, async {
                Err(ClientError::PackageDownload(String::from(
                    "injected acquisition failure",
                )))
            })
            .await
            .expect_err("first acquisition must fail");
        assert!(matches!(error, ClientError::PackageDownload(_)));

        let resolved = cache
            .get_or_acquire(
                String::from("failure"),
                None,
                uncached_package(package.path().to_path_buf()),
            )
            .await
            .expect("retry starts a fresh acquisition");
        assert_eq!(resolved.manifest.name, "demo");
        let stats = cache.stats().await;
        assert_eq!(stats.acquisitions, 2);
        assert_eq!(stats.pending_acquisitions, 0);
    }

    #[tokio::test]
    async fn timed_out_flight_is_removed_before_retry() {
        let package = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(package.path(), test_package()).unwrap();
        let mut options = test_cache_options();
        // Leave enough headroom for the successful retry to validate and copy
        // its package even when the test suite is contending for disk I/O.
        options.acquisition_timeout_ms = 250;
        let cache = Arc::new(ProcessPackageCache::new(options).unwrap());

        let error = cache
            .get_or_acquire(String::from("timeout"), None, async {
                std::future::pending::<Result<VerifiedPackage, ClientError>>().await
            })
            .await
            .expect_err("acquisition must time out");
        assert!(error.to_string().contains("acquisition_timeout_ms"));

        let resolved = cache
            .get_or_acquire(
                String::from("timeout"),
                None,
                uncached_package(package.path().to_path_buf()),
            )
            .await
            .expect("retry starts after timed-out flight cleanup");
        assert_eq!(resolved.manifest.name, "demo");
        assert_eq!(cache.stats().await.pending_acquisitions, 0);
    }

    #[tokio::test]
    async fn pinned_entries_block_eviction_then_lru_evicts_after_release() {
        let first = tempfile::NamedTempFile::new().unwrap();
        let second = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(first.path(), test_package_with_version("1.0.0")).unwrap();
        std::fs::write(second.path(), test_package_with_version("2.0.0")).unwrap();
        let mut options = test_cache_options();
        options.max_entries = 1;
        let cache = Arc::new(ProcessPackageCache::new(options).unwrap());

        let installed_first = cache
            .get_or_acquire(
                String::from("first"),
                None,
                uncached_package(first.path().to_path_buf()),
            )
            .await
            .unwrap();
        let first_digest = installed_first.digest.clone();
        let error = cache
            .get_or_acquire(
                String::from("second"),
                None,
                uncached_package(second.path().to_path_buf()),
            )
            .await
            .expect_err("a live package pin must block eviction");
        assert!(matches!(
            error,
            ClientError::PackageCacheEntryCapacity { .. }
        ));

        drop(installed_first);
        let installed_second = cache
            .get_or_acquire(
                String::from("second-retry"),
                None,
                uncached_package(second.path().to_path_buf()),
            )
            .await
            .unwrap();
        assert_ne!(installed_second.digest, first_digest);
        assert!(cache.get(&first_digest).await.is_none());
        let stats = cache.stats().await;
        assert_eq!(stats.entries, 1);
        assert_eq!(stats.evictions, 1);
        assert_eq!(stats.capacity_failures, 1);
    }

    #[tokio::test]
    async fn distinct_pending_source_keys_are_bounded() {
        let package = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(package.path(), test_package()).unwrap();
        let mut options = test_cache_options();
        options.max_concurrent_acquisitions = 1;
        options.max_pending_acquisitions = 1;
        let cache = Arc::new(ProcessPackageCache::new(options).unwrap());
        let gate = Arc::new(Semaphore::new(0));
        let leader_cache = Arc::clone(&cache);
        let leader_gate = Arc::clone(&gate);
        let path = package.path().to_path_buf();
        let leader = tokio::spawn(async move {
            leader_cache
                .get_or_acquire(String::from("first"), None, async move {
                    leader_gate
                        .acquire_owned()
                        .await
                        .expect("test pending gate")
                        .forget();
                    uncached_package(path).await
                })
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while cache.stats().await.pending_acquisitions != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("leader registers its flight");

        let error = cache
            .get_or_acquire(
                String::from("second"),
                None,
                uncached_package(package.path().to_path_buf()),
            )
            .await
            .expect_err("distinct pending source must hit the bound");
        assert!(matches!(
            error,
            ClientError::PackageCachePendingLimit { limit: 1 }
        ));
        gate.add_permits(1);
        leader.await.unwrap().unwrap();
    }
}
