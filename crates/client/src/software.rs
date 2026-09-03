use std::fmt;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use reqwest::header::{ACCEPT_ENCODING, LOCATION};
use reqwest::{redirect, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::ClientError;

pub const DEFAULT_MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
pub const DEFAULT_PACKAGE_DOWNLOAD_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_PACKAGE_CONNECT_TIMEOUT_MS: u64 = 5_000;
pub const DEFAULT_PACKAGE_REDIRECT_LIMIT: usize = 3;
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
        }
    }
}

enum PackageBacking {
    Owned(tempfile::TempPath),
    Borrowed(PathBuf),
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

#[derive(Debug, Clone)]
pub struct PackageResolver {
    options: PackageResolverOptions,
}

impl PackageResolver {
    pub fn new(options: PackageResolverOptions) -> Result<Self, ClientError> {
        options.validate()?;
        Ok(Self { options })
    }

    pub async fn resolve(&self, source: PackageSource) -> Result<VerifiedPackage, ClientError> {
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
            size = size.checked_add(chunk.len() as u64).ok_or_else(|| {
                ClientError::PackageTooLarge {
                    observed: u64::MAX,
                    limit: self.options.max_package_bytes,
                }
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
            .ok_or_else(|| ClientError::PackageTooLarge {
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

    fn test_package() -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::<u8>::new());
        let manifest = br#"{"name":"demo","version":"1.0.0"}"#;
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, "agentos-package.json", &manifest[..])
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
                expected_digest: Some(from_path.digest.clone()),
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
}
