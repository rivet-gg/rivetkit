# 12: Prototype the TypeScript Contract Generator

**Status:** Proposed prototype

## Outcome

Build an agentOS-specific bindgen prototype as its own package. Use the completed
Rust action and event contract as the source of truth and generate the
TypeScript actor types and thin client ergonomics from it. Do not modify
RivetKit in this project.

The prototype restores `@rivet-dev/agentos` as the sandbox actor client without
restoring a TypeScript actor implementation. Generalizing the approach for other
RivetKit actors is a possible later project, not an acceptance condition here.

## Package boundary

Add a workspace package at `packages/agentos-bindgen`, named
`@rivet-dev/agentos-bindgen` if it is published. It owns:

- The agentOS contract intermediate representation.
- Rust schema export for agentOS action, event, and error DTOs.
- The TypeScript emitter and agentOS package template.
- A deterministic generate/check command used by the workspace and release
  pipeline.

Keep committed product versions at `0.0.1`. The package may remain private while
it is a build tool; generated `@rivet-dev/agentos` sources may still be committed
for consumers that do not have a Rust toolchain.

The package must not patch, fork, or add features to RivetKit. It can consume the
actor's explicit registration manifest and add agentOS-local schema derives or
descriptors to the actor DTOs.

## Source of truth

Every public Rust action contributes:

- Exact dotted name.
- Versioned request DTO.
- Versioned success DTO.
- Typed error variants.
- Documentation.
- Request, response, item, and stream limit metadata where applicable.

Every public event contributes its dotted name and versioned payload DTO. The
agentOS actor build exports a deterministic machine-readable schema, and the
bindgen package emits TypeScript from it.

RivetKit currently records Rust action names but does not expose request, output,
event, or error schemas. The prototype bridges that gap only for agentOS by
maintaining one agentOS-local contract registry next to action registration. A
test compares its names with RivetKit's registered action set so the two cannot
drift silently.

## Prototype sequence

1. Export representative agentOS-local types: unit args, one object arg,
   positional tuple args, bytes, bounded integers, optional fields, tagged
   enums, a dotted name, an event, and a `RivetError`.
2. Generate a temporary actor definition and run it against a real Rust actor
   through the TypeScript RivetKit client.
3. Verify RivetKit's positional CBOR mapping: objects become `[object]`, tuples
   remain positional, scalars become `[scalar]`, and unit becomes `[]`.
4. Expand the same prototype to the complete agentOS action and event registry.
5. Generate the final `@rivet-dev/agentos` contract and fail CI when generated
   files differ.

This is intentionally a prototype with a product-specific registry. Do not add
a handwritten parallel TypeScript contract or make RivetKit generalization part
of the critical path.

## Generated TypeScript shape

Dotted action names become nested properties:

```ts
type AgentOsActions = {
  config: {
    get(): Promise<AgentOsConfigSnapshot>;
    set(input: SetConfigInput): Promise<AgentOsConfigSnapshot>;
  };
  filesystem: {
    readFile(input: ReadFileInput): Promise<ReadFileResult>;
  };
  network: {
    fetchStream: {
      start(input: FetchStreamStartInput): Promise<FetchStreamHead>;
      read(input: FetchStreamReadInput): Promise<FetchStreamChunk>;
      cancel(input: FetchStreamCancelInput): Promise<void>;
    };
  };
};
```

The vanilla RivetKit actor proxy already maps nested property access to dotted
action names. The generated client uses that behavior rather than introducing a
parallel RPC or HTTP API.

## Generated client surface

`@rivet-dev/agentos` exports:

- Generated actor creation config, action request/result, event, status, and
  error types.
- The typed actor definition/handle required by the vanilla RivetKit client.
- Small transport helpers for bytes, streams, fetch-like requests, process event
  subscriptions, and terminal subscriptions where raw actions are not ergonomic.
- Framework bindings only when they are thin subscriptions to the generated
  contract.

It does not export:

- An actor implementation or actor factory.
- VM policy defaults.
- Config reconciliation logic.
- Session or agent abstractions.
- ACP types.
- Host binding registration for the hosted actor.
- Legacy flat action aliases.
- A custom network endpoint that bypasses vanilla actor actions.

Embedded `@rivet-dev/agentos-core` remains separate and keeps its host binding
API. Do not duplicate Core implementation into `@rivet-dev/agentos`.

## Wrapper rules

- A wrapper may translate `Uint8Array`, headers, `Request`, `Response`, async
  iteration, or event callbacks into generated DTOs.
- A wrapper may cancel a stream it opened when the iterator closes.
- A wrapper may detect sequence gaps and call the documented replay action.
- A wrapper may not choose permissions, defaults, mount policy, restart policy,
  retries, package references, or timeout values unless the caller explicitly
  requests them.
- Actor and Core errors retain the generated code and structured details.
- Browser entry points remain disabled unless separately approved.

## Schema checks

There is no backward compatibility obligation. Rust binary, Rust client,
TypeScript client, and protocol crates are released in same-version lockstep.

Add checks that:

- Generated files are current and deterministic.
- Every registered public action and event appears in the agentOS schema.
- No schema item lacks a Rust handler.
- Dotted names reconstruct the expected nested TypeScript tree.
- No action collides with a parent property or another dotted path.
- Byte encodings and integer ranges round-trip across Rust and TypeScript.
- Structured Rust failures preserve `RivetError` group, code, message, and
  metadata in TypeScript.
- Removed agent/session/ACP and flat names do not reappear.

## Tests

- Focused prototype test covering all supported schema constructs.
- Type tests for the complete nested action tree.
- Runtime fixtures for every action request/result and event payload.
- Error round trips, including Core errno and actor limit/config errors.
- Binary body, repeated header, stream chunk, process output, and terminal data
  round trips.
- Wrapper cleanup for canceled fetch streams and event subscriptions.
- A generated-client smoke test against the compiled Rust actor.
- Absence tests for TypeScript actor code and removed APIs.

## Acceptance criteria

- `packages/agentos-bindgen` generates the agentOS TypeScript contract.
- No RivetKit repository or package is modified by this project.
- Rust is the single source of public hosted actor DTOs and names.
- The TypeScript client uses vanilla RivetKit actor actions.
- Wrappers are transport-only and contain no runtime policy.
- Rust and TypeScript pass shared conformance fixtures.
- Publication does not require shipping TypeScript actor source.

## Dependencies and follow-up

Depends on steps 03 through 11. Prototype representative shapes early enough to
avoid unrepresentable Rust DTOs, then stabilize the complete output only after
the action set is final. Step 14 publishes the generated lockstep artifacts.
Possible RivetKit generalization is tracked separately in step 15 and is not
required for this refactor.
