# 11: Implement Dynamic Configuration

**Status:** Proposed

## Outcome

Complete the durable desired-configuration API for the static actor. Creation
and later mutation use the same input type and one Core-owned normalization
path. Mutation replaces the complete config document; it is not a merge patch,
JSON Patch, or list of field operations.

## Actions

- `config.get`
- `config.set`
- `runtime.restart`

`config.set` is the only generic configuration mutation. Filesystem, preview,
permission, and runtime helpers do not maintain independent config slices or
perform hidden read-modify-write operations.

`software.install` and `software.uninstall` are explicit domain mutations of the
software set defined in step 08. They update the same config revision and record;
they do not create a second source of truth.

## Configuration shape

The final creation and replacement schema covers:

- VM user.
- Base environment.
- Remote `.aospkg` URL sources and resolved digests.
- Allowed Node.js built-ins.
- High-resolution time policy.
- Hosted root filesystem descriptor and mount list.
- Permissions.
- Resource limits.
- Preview policy.

It deliberately excludes:

- Host bindings.
- Host paths and host mounts.
- Database implementation and file paths.
- Download credentials, ambient authentication, and egress policy.
- Cache and preload coordinator settings.
- Sidecar executable or transport configuration.
- Lifecycle callbacks.
- Schedule-driver implementation.
- Runtime-internal handles.

Operator-only settings remain immutable process configuration.

## Replacement contract

```ts
interface SetConfigInput {
  expectedRevision?: number;
  config: AgentOsActorConfigInput;
}

interface AgentOsConfigSnapshot {
  revision: number;
  desired: CompleteAgentOsActorConfig;
  appliedRevision: number | null;
  state: "applying" | "ready" | "restart_required" | "failed";
  issues: ConfigIssue[];
}
```

Every property of `CompleteAgentOsActorConfig` has a Core-owned default.
`AgentOsActorConfigInput` permits omission for ergonomics, but omission means
"reset this property to its default," not "preserve the stored value."

For example, if the stored config has environment variables and two mounts,
calling `config.set({ config: { limits: newLimits } })` resets the environment,
mounts, and every other omitted property to their defaults. The normal safe
workflow is:

1. Read the complete normalized document with `config.get`.
2. Modify the desired properties locally.
3. Send the complete result to `config.set` with `expectedRevision`.

Explicit empty arrays, empty maps, `false`, and zero-valued fields are preserved
when valid. There is no `null` deletion convention and no special array merge
behavior.

The software actions are a deliberate narrow exception to generic full-document
replacement. `software.install` adds one resolved digest idempotently;
`software.uninstall` removes one exact package id. Both accept
`expectedRevision`, run the same validation and reconciliation path as
`config.set`, and return the resulting config snapshot. They do not expose a
general array patch operation.

## Defaults ownership

Core exposes one normalization function equivalent to:

```text
normalize_config(input) -> CompleteAgentOsActorConfig
```

Creation, `config.set`, the embedded TypeScript Core API, and the Rust client all
use that implementation. The actor persists the complete normalized desired
config so `config.get` is self-contained, but it does not define or duplicate
the default values.

## Revision and transaction semantics

1. Normalize and validate the submitted config using Core.
2. Validate hosted-only serialization and security constraints.
3. Resolve and verify any new package URLs required by the candidate config
   without exposing host paths or ambient credentials.
4. Ask Core to classify the change as live, restart required, or unsupported.
5. In one actor-state transaction, compare `expectedRevision` when supplied and
   commit the complete normalized config with a monotonic revision.
6. Apply supported live changes and persist the applied revision or typed issue.
7. If restart is required, leave that state explicit until the runtime is
   replaced under the separately specified restart policy.

`expectedRevision` is optional optimistic concurrency control. Without it, last
writer wins for the entire document. With it, a stale writer receives
`config_conflict` and no state changes.

The actor never claims atomicity between the SQLite commit and an external
runtime mutation. Desired state is the durable authority. After a crash, startup
compares desired and applied revisions and reconciles again idempotently.

## Creation behavior

Actor creation accepts `AgentOsActorCreateInput { config? }`. RivetKit passes it
to `create_state` only on first creation. Invalid input aborts that creation with
the typed error thrown by the actor.

The actor normalizes the supplied config, or an empty input, and stores the
complete result as revision 1. Once state exists, later `getOrCreate` input is
ignored by ordinary RivetKit state semantics. It is not compared with stored
config and never acts as an update.

## Restart behavior is deferred

This step identifies when a config requires runtime replacement and exposes that
fact through `config.get` and `runtime.status`. It does not define graceful
process draining, signals, terminal shutdown, or force-kill timing. Those
semantics are tracked as follow-up work.

Until that follow-up lands, `runtime.restart` uses the existing bounded Core
runtime replacement primitive and reports failure accurately. No spec in this
series should imply stronger graceful-shutdown guarantees.

If boot fails, preserve desired config, report failed reconciliation, and allow a
later corrected replacement or explicit restart. Do not silently fall back to
an old configuration while reporting success.

## Health and readiness

`runtime.status` and platform health expose:

- Desired and applied revisions.
- Reconciliation state and restart requirement.
- Required software acquisition state.
- Optional preload state separately.
- Runtime generation and lifecycle state.
- Bounded typed issues with timestamps.

Readiness succeeds only when the desired revision is applied and its required
packages are present. It never waits indefinitely. Optional predicted preloads
have their own deadline and do not make an otherwise ready actor fail.

## Tests

- Full config and omitted config at creation.
- Full-document replacement and normalization.
- A subset resets every omitted property to its Core default.
- Read-modify-set with `expectedRevision` preserves unrelated caller-selected
  values.
- Expected-revision conflicts under concurrent writers.
- Last-writer-wins behavior when `expectedRevision` is absent.
- Explicit empty arrays, empty maps, `false`, zero values, and omission semantics.
- Live application, restart-required reporting, and failed reboot.
- Crash after desired commit but before live apply, followed by reconciliation.
- Software install/uninstall updates the same config revision and behaves
  identically to the corresponding complete config replacement.
- Rejection of host bindings, host paths, callbacks, database details,
  package-source credentials, and operator limits.
- Schema migration and revision monotonicity.

## Acceptance criteria

- Creation and mutation use one versioned input type and Core normalization
  implementation.
- `config.set` replaces one complete normalized desired document.
- Omitted properties reset to defaults; no field or array is incrementally
  patched.
- Software install/uninstall are bounded exact-set operations over that same
  desired document, not a second package state store.
- Desired config and its revision survive every actor/process restart.
- Optimistic concurrency prevents silent overwrite when callers opt into it.
- Core, not the actor, owns defaults and restart classification.
- Every committed revision is either applied or visibly failed/pending.
- Actor health distinguishes required package work from optional preloading.

## Dependencies and follow-up

Depends on all feature layers through step 10 so the reconciler can classify the
whole config. Step 12 generates this final Rust contract for TypeScript.
Graceful restart and process-drain behavior, filesystem-path installation, and
the name/version registry are tracked in step 15.
