# 07: Implement Networking, Previews, and Scheduling

**Status:** Proposed

## Outcome

Expose VM HTTP access, bounded streaming fetches, preview URLs, and scheduled
command execution. Core continues to own guest networking and command semantics;
the actor uses RivetKit's ordinary request and cron APIs for actor-specific
routing, wakeups, and persistence.

## Networking actions

- `network.fetch`
- `network.fetchStream.start`
- `network.fetchStream.read`
- `network.fetchStream.cancel`

`network.httpRequest` remains the shared low-level Core request API but is not a
hosted action. `network.fetch` and its streaming form are actor-safe DTOs for
routing an HTTP request to a VM port. Preserve repeated response headers,
especially `set-cookie`, rather than collapsing them into a map.

## Preview actions

- `network.preview.create`
- `network.preview.expire`

Preview creation stores a random token, VM port, and expiration timestamp in the
actor's SQLite database and returns a path under the actor's ordinary request
gateway. The actor's `on_fetch` handler validates that row and proxies the request
through Core's VM networking API.

There is no separate preview-leasing service. "Lease" means only the current
TTL-bound token row. It survives actor sleep and process restart until expiration.
Expiration is idempotent, and a bounded lazy or scheduled cleanup removes expired
rows. Preview configuration limits token count and maximum TTL.

## Cron actions

- `cron.schedule`
- `cron.list`
- `cron.cancel`

The only target is a serializable process execution descriptor. There is no
session prompt or agent target.

The hosted actor uses RivetKit's existing `ctx.cron()` API for expression
validation, durable storage, wakeups, listing, history limits, and cancellation:

1. `cron.schedule` validates a bounded process execution descriptor.
2. The actor registers a private scheduled action through `ctx.cron().set()` or
   `ctx.cron().every()`.
3. RivetKit wakes the actor and dispatches that action.
4. The scheduled action invokes the same Core process path as `process.exec`.
5. `cron.fired` reports the process id or typed launch failure.

The private dispatch action is omitted from the generated public TypeScript
client. No agentOS cron table, parser, wakeup loop, or Actor Runtime Socket driver
is added. Embedded TypeScript Core may keep its in-process command scheduler, but
the hosted actor does not use it.

## Stream registry

Streaming fetch handles are actor-owned transport resources around Core streams.
The registry must be bounded by count, total buffered bytes, idle duration, and
absolute lifetime. Handles include the runtime generation and cannot be reused
after restart.

Every handle is released on:

- End of stream.
- Explicit cancellation.
- Read failure.
- Client disconnect when observable.
- Idle or absolute timeout.
- VM shutdown or replacement.
- Actor shutdown.

Reads return at most the requested bytes capped by an operator maximum. The
actor never reads an entire response into memory to implement streaming.

## Limits and SSRF boundary

- Validate VM port range, method size, header count/bytes, URL size, body bytes,
  concurrent streams, response chunk bytes, preview count, preview lifetime,
  cron job count, and serialized command size.
- `network.fetch` addresses a port inside the actor's VM. It must not become an
  arbitrary host fetch or metadata-service proxy.
- Guest outbound access remains controlled by Core permissions.
- Preview ingress cannot access sidecar control endpoints or actor-internal
  ports.
- Errors preserve guest connection failures separately from Rivet route and
  actor transport failures.

## Tests

- Buffered request status, body, duplicate headers, and errors.
- Streaming response backpressure, partial reads, cancellation, timeout, and
  cleanup after restart.
- Stream count and byte limits.
- Preview create, route, expire, expiry timeout, unauthorized access, sleep/wake,
  and bounded expired-row cleanup.
- Rejection of control ports, invalid ports, unsafe URLs, and oversized requests.
- Cron create/list/cancel, actor sleep/wake, missed wakeup, duplicate wakeup, and
  process launch.
- Cron persistence across process restart using RivetKit storage and no Actor
  Runtime Socket.
- No agent/session scheduled target remains representable.

## Acceptance criteria

- Networking actions delegate I/O to Core's shared reactor capabilities.
- The actor's stream registry is bounded and has no leaked handles.
- Preview routing uses one TTL-bound actor SQLite row and Core networking.
- Command schedules survive actor sleep and do not depend on Actor Runtime
  Socket.
- The actor contains no cron parser, schedule database, wakeup loop, or guest
  networking policy.
- Every networking, preview, and scheduling failure is typed and observable.

## Dependencies and follow-up

Depends on steps 03 and 05. Preview policy joins the general dynamic config API
in step 11. The TypeScript wrapper for fetch-like ergonomics is generated and
implemented in step 12 without owning stream policy.
