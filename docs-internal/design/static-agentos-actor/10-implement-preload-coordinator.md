# 10: Implement the Preload Coordinator

**Status:** Proposed

## Outcome

Add one central actor that maintains a low-frequency, approximate hot set of
exact agentOS software packages. Each agentOS process reads the set once at
startup and warms its local package cache within a deadline. Per-process usage
messages are coalesced before being sent to the coordinator.

This component optimizes cold starts only. It is not a package byte store, lock
service, catalog, source of truth, or requirement for successful actor execution.

## Internal actor API

Use internal dotted actions with versioned DTOs:

| Action | Input | Result |
| --- | --- | --- |
| `preload.getPlan` | process/runtime capabilities and optional max entries | plan revision, exact URL/digest package identities, expiry |
| `preload.recordUsage` | process id, observation window, coalesced package counts | accepted plan revision |
| `preload.replaceBaseline` | operator-authorized URL/digest package identities | new plan revision |
| `preload.status` | none | bounded coordinator health and plan summary |

`replaceBaseline` is an operator control-plane action, not available through the
public agentOS actor client. If operator configuration provides the baseline
outside an action, omit this action rather than exposing two authorities.

The public `agentOS` actor has no preload action. Its process bootstrap code is a
client of this internal actor.

## Process bootstrap

1. Initialize the process-local package cache.
2. Read `preload.getPlan` once with a short deadline.
3. Validate the bounded plan and discard expired or unsupported entries.
4. Fetch and warm entries concurrently through the normal URL downloader and
   digest cache from steps 08 and 09, respecting their bounds.
5. Stop optional warming at the configured process startup deadline.
6. Record successes, failures, and skipped entries.
7. Start serving actors even if the coordinator is unavailable or optional
   warming is incomplete.

Required packages in an actor's durable config are still acquired on that
actor's startup. They may benefit from warmed bytes but never rely on the
coordinator to identify them.

Only resolved `{ url, digest, size? }` identities are eligible for the plan.
Entries without a pinned digest are not safe preload inputs because URL contents
may change.

## Usage coalescing

Maintain one bounded process-level observation map keyed by URL and verified
digest. Actor package use increments the local counter without sending a message.
A low-frequency timer swaps the map and sends one `preload.recordUsage` call.

- Cap distinct keys and counters.
- Merge overflow into bounded summary counters or drop it with a metric.
- Add bounded jitter so processes do not flush simultaneously.
- Retry at most within a small budget. Dropping a window is acceptable.
- Do a bounded best-effort flush on process shutdown, while never delaying
  shutdown past its deadline.
- Do not write on every action, actor start, or package access.

## Hot-set policy

Start with a small recency-weighted exact map rather than a complex sketch:

- Exact artifact digest is the ranking key; the stable URL is retained for
  acquisition.
- Each usage batch updates a decaying score and last-observed time.
- An operator baseline contributes a fixed minimum score or reserved slots.
- Deterministic eviction keeps at most the configured package count and total
  predicted artifact bytes.
- Scores decay on observation/update or periodic compaction, not a high-frequency
  timer.
- Plans have a revision and expiry so processes can reject stale corrupted state.

Accuracy is explicitly best effort. Concurrent stale writes, lost batches, and
temporary coordinator unavailability can change ranking but not behavior.

## Persistence and limits

The coordinator owns its own actor SQLite schema, separate from every agentOS
actor database. Name it for the coordinator rather than placing it in
`agentos_actor_*` for a VM actor.

Bound plan entries, observation entries, request bytes, stored candidates,
baseline size, artifact byte estimate, update frequency, and response bytes.
Reject or truncate according to explicit typed rules. Never return an unbounded
history of observations.

## Observability

Measure plan read latency and failure, plan age/revision, warm hit/miss/failure,
warm bytes and deadline, usage batch size, coalescing ratio, dropped observations,
and coordinator update frequency. Avoid package-name metric labels.

## Tests

- Process reads exactly once per process bootstrap.
- Coordinator unavailable, slow, stale, malformed, or over limit.
- Warm deadline and partial completion.
- Many actor package observations become one process message per window.
- Bounded observation overflow and process shutdown behavior.
- Deterministic ranking, decay, baseline reservation, and eviction.
- Lost, duplicated, stale, and reordered usage batches.
- Concurrent processes update without requiring exact counts.
- Coordinator failures never prevent required package resolution.

## Acceptance criteria

- Optional hot-package bytes are commonly available before the first actor needs
  them, within the configured startup budget.
- Coordinator reads occur once per process startup, not once per actor.
- Writes are coalesced per process and low frequency.
- The coordinator never proxies package bytes.
- No correctness, authorization, or desired state depends on its plan.
- Every map, message, plan, timer, and warm operation is bounded.

## Dependencies and follow-up

Depends on the URL package source and cache from steps 08 and 09. Step 14 deploys
and operates the coordinator alongside the static actor.
