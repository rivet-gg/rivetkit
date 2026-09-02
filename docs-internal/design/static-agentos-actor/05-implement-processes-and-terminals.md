# 05: Implement Processes and Terminals

**Status:** Proposed

## Outcome

Expose process and interactive terminal APIs from Rust while moving replay and
terminal state needed by every client into shared Core/sidecar ownership. The
actor forwards calls and events; it does not reproduce a process manager or
terminal emulator.

## Process actions

- `process.exec`
- `process.execFile`
- `process.spawn`
- `process.get`
- `process.list`
- `process.tree`
- `process.wait`
- `process.signal`
- `process.writeStdin`
- `process.closeStdin`
- `process.resizePty`
- `process.readOutput`

`exec` accepts a shell command according to the existing Core contract.
`execFile` accepts an executable plus argv and does not add actor-side shell
parsing. `spawn` returns a stable runtime-scoped process id. Embedded Core may
retain `process.kill` as a convenience; the actor client expresses the same
operation with `process.signal({ signal: "SIGKILL" })` without another wire
action.

## Terminal actions

- `terminal.open`
- `terminal.list`
- `terminal.snapshot`
- `terminal.write`
- `terminal.resize`
- `terminal.wait`
- `terminal.close`

Terminal ids and process ids include or are validated against a runtime
generation so stale handles cannot target a replacement VM after config restart.

## Events

- `process.output`
- `process.exit`
- `terminal.data`
- `terminal.stderr`
- `terminal.exit`
- `runtime.limitWarning` for near-capacity process, terminal, event, or replay
  limits

## Move replay below the actor

The deleted TypeScript actor currently owns process event encoding, open-shell
tracking, and a shell screen replay buffer. That is too much behavior for the
new actor and produces inconsistent embedded and hosted clients.

Add shared Core/sidecar capabilities for:

- Bounded sequenced stdout and stderr replay per process.
- Bounded terminal byte replay and screen snapshots.
- Live process and terminal enumeration.
- Output gap detection and the oldest/newest available sequence.
- Cleanup on exit, close, runtime shutdown, and configured retention expiry.

The Rust actor subscribes once per runtime generation and forwards those events.
It does not parse terminal escape sequences or maintain a second replay buffer.
If screen emulation cannot live in the sidecar in this revision, narrow the
public contract to raw bounded replay and defer `terminal.snapshot` rather than
copying the TypeScript emulator into actor glue.

## Backpressure and lifecycle

- Guest execution remains on the bounded executor separate from Tokio runtime
  workers.
- Process and terminal output use coalesced readiness and bounded work.
- At most one pending wake is queued per execution session.
- Writes honor sidecar admission and propagate a typed backpressure error or
  await a bounded deadline.
- Actor event delivery is a notification path. A slow or disconnected actor
  client cannot block guest output indefinitely.
- Consumers recover dropped notifications through `process.readOutput` or
  terminal replay.
- `wait` calls are cancellable at the actor request boundary without canceling
  the process itself unless explicitly requested.
- Runtime replacement invalidates old-generation handles and reports typed
  termination. Graceful drain and signal policy is deferred to step 15.

## Limits

Define operator-configurable bounded defaults for:

- Concurrent processes and terminals per VM.
- Pending spawns and executions.
- Command and argv encoded bytes.
- Environment variables and aggregate environment bytes.
- Stdin write bytes.
- Output chunk bytes and event queue depth.
- Replay bytes per process, per terminal, and per VM.
- Terminal snapshot dimensions and encoded size.
- Wait duration and retained exited-process metadata.

Warnings name the limit before it is exhausted. Limit errors explain the
operator setting used to raise it.

## Tests

- Process lifecycle parity through TypeScript Core, Rust client, and actor.
- Shell and argv execution remain distinct.
- Interleaved stdout/stderr sequences and output gap recovery.
- Event subscriber disconnect and reconnect with replay.
- Terminal open, resize, snapshot/replay, close, and exit.
- Stale ids after runtime restart.
- Signal delivery without spawning one OS thread per signal.
- Backpressure with a slow reader and bounded memory.
- All configured process, terminal, queue, and replay limits.
- Runtime crash and actor shutdown clean every subscription and handle.

## Acceptance criteria

- Every action delegates process semantics to Core.
- The actor owns no process table, terminal emulator, or authoritative replay
  buffer.
- Live output is recoverable after event loss within documented bounds.
- No wait, stream, subscription, or task leaks across actor sleep or runtime
  restart.
- Process and terminal behavior is equivalent across both Core clients.
- Resource exhaustion produces typed, observable failures.

## Dependencies and follow-up

Depends on step 03. It may use files implemented in step 04 for executable and
working-directory tests, but it must not create a second filesystem path.
