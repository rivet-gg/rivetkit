# 13: Delete the Stale agentOS Apps Copy

**Status:** Proposed

## Outcome

Delete the obsolete agentOS Apps implementation from this repository. The
product has moved to the separate Dynamic Apps repository and must not remain as
a second package, example set, test suite, benchmark, or design surface inside
agentOS.

This is a deletion revision. It does not migrate Dynamic Apps, add compatibility
exports, or place app lifecycle hooks in the static `agentOS` actor.

## Scope

- Delete `packages/agentos-apps` and remove it from workspace, Turbo, build,
  test, lint, and publish discovery.
- Delete agentOS Apps examples under `examples/`.
- Delete its end-to-end tests and benchmarks.
- Delete internal and public design pages, graphics, navigation, and runnable
  snippets that document the obsolete package.
- Remove root scripts, `justfile` recipes, CI paths, dependency edges, and lockfile
  entries that exist only for the deleted package.
- Remove references to `@rivet-dev/agentos-apps` from retained agentOS packages.

Use repository search to determine the exact directories. The initial expected
set includes `packages/agentos-apps`, `examples/apps-*`,
`tests/e2e/agentos-apps`, and `benchmarks/agentos-apps`, but those names are not
an exhaustive deletion list.

## Explicitly out of scope

- Editing the separate Dynamic Apps repository.
- Replacing `@rivet-dev/agentos-apps` with a forwarding or compatibility
  package.
- Reintroducing `onVmStart`, `onVmStop`, `onVmDisposed`, `resolveOptions`, or
  other app callbacks in the hosted actor.
- Migrating unrelated consumers to the new Rust actor; that belongs in step 14.

The Dynamic Apps repository currently depends on the configurable TypeScript
actor and its lifecycle hooks. Its migration must be designed and reviewed in
that repository after the static actor contract is available.

## Validation

- `rg` finds no retained import, export, workspace entry, publish entry, or docs
  route for `@rivet-dev/agentos-apps`.
- `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm check-types` pass for
  the retained workspace, or the revision documents an intentional stack break
  that a named later revision repairs.
- Publish discovery contains no agentOS Apps package or artifact.
- Public documentation build and link checks pass after route and navigation
  deletion.

## Acceptance criteria

- There is one Apps product: the separate Dynamic Apps project.
- No agentOS Apps implementation or compatibility shell ships from this
  repository.
- The static `agentOS` actor contract contains no app abstraction or lifecycle
  hook.
- No retained default build, test, docs, or publication path references the
  deleted package.

## Dependencies

Land after the TypeScript contract work in step 12 so it stays an independently
reviewable deletion. Step 14 owns downstream migration and release cutover.
