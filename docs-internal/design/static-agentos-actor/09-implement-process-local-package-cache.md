# 09: Implement the Process-Local Package Cache

**Status:** Proposed

## Outcome

Add a bounded process-local content-addressed cache for verified `.aospkg`
artifacts. All actor instances in one process share acquisition, validation, and
immutable bytes. The cache is a performance layer, not durable desired state and
not an authorization boundary. Its result is a pinned immutable package handle
that Core can memory-map and project, never an actor-visible operating-system
path.

## Component API

The cache exposes an internal async interface equivalent to:

```text
get(digest) -> CacheHit | CacheMiss
get_or_fetch(remote_source, fetcher) -> CachedArtifact
pin(digest, actor_runtime_generation) -> Pin
release(pin) -> void
warm(resolved_remote_sources, deadline) -> WarmReport
record_access(digest) -> void
stats() -> CacheStats
```

Callers never read or write a cache path directly. `CachedArtifact` returns a
read-only mmap/blob handle supported by Core/VFS package projection. Extending
the actor API to accept a private host cache path is explicitly out of scope.

## Storage model

- Key immutable objects by verified `.aospkg` digest, not a mutable object-store
  path.
- Maintain a bounded advisory index from normalized URL plus HTTP validators to
  resolved digest and verified metadata.
- Acquire into a uniquely created private staging object behind the cache
  implementation.
- Verify before atomically publishing an immutable digest entry.
- Treat existing digest objects as immutable. A size or content mismatch is
  corruption, not a reason to overwrite silently.
- Keep actor-specific writable filesystem overlays outside this cache.
- Recover the bounded index from private object metadata or a small local
  database without trusting incomplete staging objects.

The implementation may use operator-owned local storage internally, but neither
the actor contract nor the Core package API can name, open, or mount that storage
as a host path.

## Single-flight behavior

Concurrent requests for the same known digest share one bounded acquisition
future per process. When the digest is omitted, concurrent requests for the same
normalized URL share a short-lived resolution flight and then join the digest
entry. Requests for different content use a global acquisition semaphore.

- Success wakes all waiters with the same immutable handle.
- Failure wakes all waiters with the same typed failure and removes the flight so
  a later bounded retry can occur.
- Waiter cancellation does not cancel a fetch still required by other waiters.
- A flight has a deadline and cannot remain permanently registered.
- URL-resolution flights are advisory and never make URL text the immutable
  content key.

## Eviction and pinning

Use byte-bounded LRU eviction locally. Track last access and size, but do not
persist high-frequency access synchronously.

- Pinned artifacts used by a live VM cannot be evicted.
- A cache insertion that cannot meet its byte limit after evicting unpinned
  entries fails with a typed capacity error.
- Over-limit pinned bytes are visible in metrics and status. The cache does not
  delete a live package to force itself under limit.
- Eviction removes URL-to-digest indexes before the object and tolerates a
  process crash between those operations.
- Different URLs that resolve to the same digest store one object.
- Startup cleans stale temporary files using a bounded scan and age threshold.

## Process ownership

Initialize one cache service for the process, outside individual actor state.
Actor shutdown releases only its pins. Process shutdown performs a bounded flush
of access metadata and usage observations but does not make correctness depend
on that flush.

The cache configuration is operator-owned:

- Cache storage implementation and capacity.
- Maximum bytes and object count.
- Maximum concurrent resolutions and downloads.
- Download and verification timeouts.
- Temporary file expiry.
- Near-capacity warning threshold.

No actor action may raise these process-wide limits.

## Observability

Record bounded-cardinality metrics for hits, misses, coalesced waiters,
downloads, verification failures, inserted and evicted bytes, pinned bytes,
capacity failures, warm duration, and cleanup. Package names may be logged for
debugging but should not become unbounded metric labels.

Every background cleanup or index flush failure is logged. Corruption is
quarantined or removed with an explicit record; it is never treated as a cache
hit.

## Tests

- Hit, miss, insert, restart recovery, and URL-to-digest index behavior.
- Hundreds of concurrent same-digest requests cause one fetch.
- Independent digests honor the global acquisition bound.
- Canceled waiters and failed single flights clean up.
- LRU order, byte capacity, object capacity, pins, and over-limit pinned state.
- Crash-shaped partial temp files and index/object disagreement.
- Digest mismatch and immutable object corruption.
- Multiple URLs sharing one content digest.
- Actor runtime restart releases the old generation's pins.
- Warm deadline returns a partial report without leaking tasks.

## Acceptance criteria

- Package bytes are acquired and verified at most once concurrently per
  process and digest.
- Cache entries are immutable and content-addressed.
- Live VM packages remain pinned.
- Disk, memory, concurrency, cleanup, and metadata are bounded by default.
- An empty or failed cache only affects latency; exact desired artifacts remain
  available from their durable URL and pinned digest.
- Cache internals do not appear in actor creation or mutable config.

## Dependencies and follow-up

Depends on the URL/path-to-verified-package contract in step 08. Step 10 reads a
central advisory hot set and calls `warm`; it does not bypass this cache or
introduce a host path.
