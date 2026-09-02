# 14: Migrate Integrations and Publishing

**Status:** Proposed

## Outcome

Move supported consumers to the static Rust `agentOS` actor and generated
TypeScript client, remove consumers of agents/sessions/ACP, update release and
deployment machinery, and ship the sandbox-only architecture in lockstep.

## Consumer inventory

Before editing consumers, generate a repository and known-downstream inventory
for:

- TypeScript actor factories and lifecycle hooks.
- Agent, session, ACP, prompt, permission, history, and adapter APIs.
- Flat actor action names.
- Actor Runtime Socket configuration.
- Host mounts or host bindings passed to the hosted actor.
- Direct assumptions about linked software paths.
- Old actor events and inspector tabs.

Classify each consumer as:

1. **Hosted sandbox:** migrate to the generated `agentOS` contract.
2. **Embedded runtime:** keep TypeScript Core, retain host bindings, and delete
   any agent/session usage.
3. **Product-owned actor:** move product-specific hooks and state into that
   product's own RivetKit actor, composed with the sandbox API where appropriate.
4. **Removed agent integration:** delete it with no compatibility layer.

The initial audit must explicitly cover Eve, Flue, Gigacode, examples, workbooks,
test harnesses, inspector UI, and release smoke tests. The actual list is
determined by repository search, not assumed complete here.

## Client migrations

- Replace old custom actor client construction with the vanilla RivetKit actor
  client typed by `@rivet-dev/agentos`.
- Convert flat action calls to nested calls.
- Move `createContext` to `contexts.create`.
- Convert `vmFetch*` to `network.fetch*`.
- Convert preview calls to `network.preview.*`.
- Convert hosted software calls to remote URL install/uninstall/list actions.
- Supply durable config through actor creation or `config.set`.
- Delete agent/session UI and workflows rather than simulating them with
  processes.
- Keep embedded host-binding consumers on `@rivet-dev/agentos-core`; do not send
  binding config to the actor.

## Release and publishing

Update `scripts/publish` as the source of truth to:

- Build and stage the static Rust actor/native-sidecar binary.
- Build required generic sidecar and runtime artifacts.
- Rebuild the complete registry command set and standalone `.aospkg` artifacts.
- Generate, verify, and upload object-store artifact manifests.
- Generate and verify the TypeScript actor contract.
- Discover only retained Rust crates, TypeScript client packages, and native
  artifacts.
- Exclude removed ACP, agent adapter, session, Actor Runtime Socket, and
  TypeScript actor artifacts.
- Publish Rust protocol/client crates, the binary, and TypeScript client in
  same-version lockstep.
- Upload native release assets and software artifacts through the configured
  S3-compatible release path, with a local dry-run target.

Committed package and crate versions remain `0.0.1`. Release scripts perform
transient version rewriting and restore/verify the tree.

## Deployment

- Deploy the `agentOS` actor binary with its operator-only package downloader,
  egress policy, cache, SQLite adapter, transport, sidecar, logging, and preload
  settings.
- Deploy one preload coordinator actor and configure processes with its stable
  identifier.
- Seed the coordinator baseline or bake the agreed default packages into the
  image.
- Configure strict readiness deadlines and distinguish optional preload timeout
  from required package failure.
- Expose metrics and logs for actor boot, config reconciliation, package acquisition,
  cache hit/miss, preload warm, process/terminal limits, previews, and cron.
- Verify that no ambient download credential, host path, or operator setting is
  present in actor-readable durable config.

## Documentation

Update public docs in the same revision to describe:

- Creating and connecting to an `agentOS` actor.
- Passing config at creation and updating it later.
- Filesystem, process, terminal, language, networking, software, and cron APIs.
- URL-based `.aospkg` installation, digest pinning, and live installed state.
- Hosted restrictions on host bindings and host mounts.
- Embedded Core host bindings as a separate deployment model.
- Config revision, restart, readiness, errors, limits, and artifact behavior.

Delete agent, session, ACP, adapter, prompt, and old TypeScript actor docs,
navigation, examples, and redirects. Runnable snippets come from checked
examples.

## Rollout

There is no data or API compatibility requirement. Rollout still needs a clear
cutover because clients and binary are lockstep:

1. Publish packages and binary under one version.
2. Deploy the preload coordinator and validate optional fallback behavior.
3. Deploy the actor runtime.
4. Migrate supported hosted consumers to the generated client version.
5. Remove old deployment configuration and secrets.
6. Confirm no old actor, Actor Runtime Socket, ACP, session worker, or adapter is
   running or published.

Do not dual-write old storage or run both actor implementations behind one actor
name.

## Validation

- `cargo check --workspace`
- `pnpm build`
- `pnpm check-types`
- Publish helper and fixed-version checks.
- Generated-contract clean-tree check.
- Targeted Rust actor, Core parity, package-download/cache, coordinator, and
  consumer integration tests.
- Full release artifact staging without publishing.
- Public website build and link check for changed routes/navigation.
- One end-to-end smoke test per supported consumer using the compiled Rust actor.
- Deployment smoke test for cold cache, warm cache, coordinator unavailable,
  config restart, process output replay, preview route, and cron wakeup.

## Acceptance criteria

- Every supported hosted consumer uses the generated static actor contract.
- Every supported embedded consumer uses sandbox-only Core and may retain host
  bindings.
- No consumer depends on agents, sessions, ACP, TypeScript actor hooks, Actor
  Runtime Socket, flat actions, or hosted host mounts.
- The release contains one static binary with the documented entry points.
- Object storage contains verified immutable `.aospkg` artifacts and manifests.
- Client, protocol, and binary versions are published together.
- Public docs and runnable examples describe only shipped behavior.
- Production health and metrics distinguish readiness correctness from preload
  optimization.

## Risks

- Dynamic Apps needs a separate downstream migration because it still consumes
  the configurable TypeScript actor hooks.
- A lockstep breaking release needs deployment ordering even without backward
  compatibility.
- Cold-start measurements must separate actor resolution, required package
  acquisition, optional preloading, Core boot, and first execution.
- Release discovery can accidentally keep dead crates/packages alive. Test the
  publish manifest as an artifact, not only individual builds.

## Dependencies

Depends on every earlier step, including the stale Apps deletion in step 13.
This is the only step that changes supported downstream consumers and
production/release configuration. Migration of the separate Dynamic Apps
repository remains downstream work and must not add callback escape hatches to
the hosted actor.
