# 08: Implement URL-Based Software Installation

**Status:** Proposed

## Outcome

Install standalone `.aospkg` software from remote URLs, cache the verified
content at process scope, memory-map the immutable package bytes, and project
them through Core/VFS under `/opt/agentos`.

The URL is only a locator. Package identity and cache correctness come from the
digest of the downloaded bytes. The hosted Rust actor never accepts or opens a
local path, host mount, file URL, descriptor, or caller-supplied filesystem.

Remove npm from agentOS registry-software distribution. Publish `.aospkg`
artifacts to stable HTTPS URLs backed initially by S3-compatible object storage.
Do not implement package names, semantic versions, ranges, dist-tags, dependency
resolution, or a registry protocol in this refactor.

## Public actor actions

```ts
interface RemotePackageSource {
  url: string;
  digest?: string;
}

interface InstallSoftwareInput {
  source: RemotePackageSource;
  expectedRevision?: number;
}

interface UninstallSoftwareInput {
  packageId: string;
  expectedRevision?: number;
}
```

- `software.install`: resolve, verify, cache, and durably add one remote package.
- `software.uninstall`: remove one exact installed package from desired state.
- `software.list`: return Core's live installed `/opt/agentos` package view.

`packageId` is a stable installed identity derived from the verified digest, not
a package name or version selector. The result of installation includes the
resolved digest, exact size, bounded manifest metadata, config revision, and
application state.

Installing the same resolved digest is idempotent. A conflicting package or
command projection fails with a typed Core error. Uninstalling an absent exact id
is either an explicit not-found error or a documented no-op; choose one behavior
before generating the client.

## Core source model

Core supports a closed source enum equivalent to:

```text
PackageSource =
  Url { url, expected_digest? }
  | Path { path, expected_digest? }

resolve(source, limits) -> VerifiedPackage
project(package_set, runtime_generation) -> InstalledPackageSet
```

The embedded Core API may use either variant because its caller is deliberately
running in the host process. The hosted actor DTO exposes only `Url`. Serde or
manual conversion must make it impossible for an actor request to construct the
`Path` variant.

Both sources converge immediately on the same verified immutable package:

1. Open the source through the appropriate trusted Core adapter.
2. Read it under byte, time, redirect, and concurrency limits.
3. Compute and verify its digest and size.
4. Parse and validate the `.aospkg` format and bounded manifest.
5. Publish the content into the process-local digest cache.
6. Memory-map or otherwise pin the immutable cached bytes.
7. Project packages and commands through VFS under `/opt/agentos`.

Core owns verification, mmap lifetime, collision handling, and VFS projection.
The actor owns only URL DTO validation, durable actor state, action routing, and
status translation.

Remote package bytes are untrusted input even when their URL came from a trusted
client or registry. Parsing and projection remain bounded trusted-Core code;
package executables run only inside the untrusted guest boundary.

Installing packages from a path inside the guest/actor filesystem is deferred.
It may be useful later, but it is not needed to establish remote package
installation and would require a separate immutable-snapshot design.

## Durable package state

Creation config and `config.set` may include a bounded list of
`RemotePackageSource`. `software.install` and `software.uninstall` are
domain-specific mutations of that same durable desired package set; they do not
create a second authoritative software database.

When the caller omits `digest`, the first successful fetch computes it and the
actor persists the resolved URL, digest, size, and package id. From that point
the digest is pinned:

- A cache hit reuses bytes by digest.
- A cache miss may fetch the URL again but must reproduce the persisted digest.
- Changed bytes at the same URL return `software_source_changed`; they never
  silently upgrade an existing actor.
- Installing the URL again explicitly may resolve new bytes and replace or add
  them according to the package collision rules.

`software.list` reports the live applied projection, not merely requested URLs.
`config.get` reports the complete durable desired sources and reconciliation
state. This distinction keeps pending or failed installation visible.

## URL and cache semantics

The content cache is keyed by digest. A URL-to-digest index is only an advisory
lookup and may use bounded HTTP validators such as ETag or Last-Modified. URL
text alone is not an immutable cache key because servers can replace bytes at
the same location.

URL handling must:

- Permit HTTPS by default and allow plain HTTP only under an explicit local-test
  policy.
- Reject `file:`, `data:`, Unix socket, and other non-HTTP schemes.
- Revalidate every redirect and enforce a small redirect limit.
- Use no ambient cookies, cloud credentials, proxy credentials, or host auth.
- Bound URL bytes, DNS/connect/read time, object bytes, concurrent downloads,
  response headers, decompression, and retries.
- Apply the actor service's network-egress/SSRF policy before connecting.
- Redact URL userinfo and sensitive query parameters from logs and errors.

Direct durable URLs should be stable and re-fetchable. Expiring presigned URLs
are a poor durable source because a cold cache may need the artifact after the
signature expires. Private registry authentication and renewable download URLs
belong in the later registry design.

## System cache and preloading

One process-local content-addressed cache is shared by actors in the process.
The cache stores verified immutable `.aospkg` content, not writable installed
filesystems. Each VM receives its own package projection backed by the same
memory-mapped bytes.

The preload coordinator records exact `{ url, digest, size? }` identities. It can
warm packages before an actor starts because the URL is globally resolvable.
Usage messages remain approximate and coalesced; only desired package state is a
correctness source.

## Remove npm publication

- Remove `@agentos-software/*` from npm publish discovery.
- Remove runtime imports of software package JavaScript descriptors.
- Remove npm dependency graphs as the mechanism for default bundles or meta
  packages.
- Remove packument, semver, dist-tag, npm integrity, npm authentication, and npm
  lifecycle logic from registry software.
- Software directories may retain private workspace manifests needed by build
  tooling, but those manifests are not published products or a runtime registry.
- Publish `.aospkg` files and a checksummed release index directly to
  S3-compatible object storage.

This does not remove npm from untrusted guest JavaScript projects.
`javascript.npm.*` remains a guest execution feature with normal VM policy.

## Artifact publication

Use immutable object keys such as:

```text
software/<package-name>/<build-id>/<sha256>.aospkg
software/<package-name>/<build-id>/manifest.json
```

The manifest records the stable HTTPS download URL, SHA-256 digest, exact size,
`.aospkg` format version, runtime package metadata, and release provenance.
`scripts/publish` rebuilds all default tools, packs every artifact, validates the
index, uploads immutable objects, and rejects different bytes at an existing
digest key.

The actor consumes only the URL and optional expected digest. S3 endpoint,
bucket, credentials, and upload policy are never actor configuration.

## Local testing

The publisher may write artifacts to a temporary directory for deterministic
tests. Actor integration tests serve that directory through a local HTTP or S3
emulator and install by URL. The actor never receives the temporary host path.

Use the same download, digest, cache, mmap, and projection path as production.
Local HTTP is enabled only by explicit test configuration.

## Tests

- Install/list/uninstall through the hosted actor using only URL sources.
- Embedded Core path and URL sources converge on identical verified packages.
- Actor decoding cannot construct a path source, including malformed or
  adversarial tagged input.
- Same URL and bytes, same URL with changed bytes, different URLs with identical
  bytes, expected-digest mismatch, truncation, oversize, and timeout.
- Scheme rejection, redirect validation, SSRF policy, DNS rebinding defenses,
  credential isolation, and log redaction.
- Concurrent same-digest installs perform one acquisition per process.
- Package and command collisions return stable typed errors.
- Desired versus live installed views during failure and restart.
- Cold-cache restart re-fetches and requires the pinned digest.
- Publish discovery contains no npm-published registry-software packages.

## Acceptance criteria

- Hosted callers install `.aospkg` software using remote URLs only.
- No hosted DTO can identify or open a host or guest filesystem path.
- Core supports trusted embedded path sources and remote URL sources through one
  verified package pipeline.
- Cached content is keyed by digest and safely memory-mapped across VM
  projections.
- A mutable URL cannot silently change an actor's installed package.
- `software.list` reflects the live installed view.
- Registry software is no longer published to or resolved from npm.
- No semantic-versioning or registry protocol is implemented.
- A future registry can return `{ url, digest, size }` without changing the Core
  installation boundary.

## Dependencies and follow-up

Depends on the filesystem projection in step 04 and actor foundation in step 03.
Step 09 implements the process-local content cache. Step 10 preloads exact URL
and digest identities. Step 11 reconciles the durable package set alongside full
config replacement. Package installation from an actor filesystem and the
name/version registry remain follow-up work in step 15.
