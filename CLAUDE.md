# RivetKit Development Guide

## Project Naming

- Use `RivetKit` when referring to the project in documentation and plain English
- Use `rivetkit` when referring to the project in code, package names, and imports

## `packages/**/package.json`

- Always include relevant keywords for the packages
- All packages that are libraries should depend on peer deps for: @rivetkit/*, @hono/*, hono

## `packages/**/README.md`

Always include a README.md for new packages. The `README.md` should always follow this structure:

    ```md
    # RivetKit {subname, e.g. library: Rivet Actor, driver and platform: RivetKit Redis Adapter, RivetKit Cloudflare Workers Adapter}

    _Lightweight Libraries for Backends_

    [Learn More →](https://github.com/rivet-gg/rivetkit)

    [Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

    ## License

    Apache 2.0
    ```

## Common Terminology

- **Actor**: A stateful, long-lived entity that processes messages and maintains state
- **Manager**: Component responsible for creating, routing, and managing actor instances
- **Remote Procedure Call (RPC)**: Method for an actor to expose callable functions to clients
- **Event**: Asynchronous message sent from an actor to connected clients
- **Alarm**: Scheduled callback that triggers at a specific time

### Coordinated Topology Terminology

- **Peer**: Individual actor instance in a coordinated network
- **Node**: Physical or logical host running one or more actor peers

## Build Commands

Run these commands from the root of the project. They depend on Turborepo, so you cannot run the commands within the package itself. Running these commands are important in order to ensure that all dependencies are automatically built.

- **Type Check:** `pnpm check-types` - Verify TypeScript types
- **Check specific package:** `pnpm check-types -F rivetkit` - Check only specified package
- **Build:** `pnpm build` - Production build using Turbopack
- **Build specific package:** `pnpm build -F rivetkit` - Build only specified package
- **Format:** `pnpm fmt` - Format code with Biome
    - Do not run the format command automatically.

## Core Concepts

### Topologies

rivetkit supports three topologies that define how actors communicate and scale:

- **Singleton:** A single instance of an actor running in one location
- **Partition:** Multiple instances of an actor type partitioned by ID, useful for horizontal scaling 
- **Coordinate:** Actors connected in a peer-to-peer network, sharing state between instances

### Driver Interfaces

Driver interfaces define the contract between rivetkit and various backends:

- **ActorDriver:** Manages actor state, lifecycle, and persistence
- **ManagerDriver:** Manages actor discovery, routing, and scaling
- **CoordinateDriver:** Handles peer-to-peer communication between actor instances
    - Only applicable in coordinate topologies

### Driver Implementations

Located in `packages/drivers/`, these implement the driver interfaces:

- **Memory:** In-memory implementation for development and testing
- **Redis:** Production-ready implementation using Redis for persistence and pub/sub

### Platforms

Located in `packages/platforms/`, these adapt rivetkit to specific runtime environments:

- **NodeJS:** Standard Node.js server environment
- **Cloudflare Workers:** Edge computing environment
- **Bun:** Fast JavaScript runtime alternative to Node.js
- **Rivet:** Cloud platform with built-in scaling and management

## Package Import Resolution

When importing from workspace packages, always check the package's `package.json` file under the `exports` field to determine the correct import paths:

1. Locate the package's `package.json` file
2. Find the `exports` object which maps subpath patterns to their file locations
3. Use these defined subpaths in your imports rather than direct file paths
4. For example, if you need to import from a package, check its exports to find if it exposes specific subpaths for different modules

This ensures imports resolve correctly across different build environments and prevents errors from direct file path imports that might change.

## Code Style Guidelines

- **Formatting:** Uses Biome for consistent formatting
    - See biome.json for reference on formatting rules
- **Imports:** Organized imports enforced, unused imports warned
- **TypeScript:** Strict mode enabled, target ESNext
- **Naming:** 
  - camelCase for variables, functions
  - PascalCase for classes, interfaces, types
  - UPPER_CASE for constants
  - Use `#` prefix for private class members (not `private` keyword)
- **Error Handling:** 
  - Extend from `ActorError` base class (packages/core/src/actor/errors.ts)
  - Use `UserError` for client-safe errors
  - Use `InternalError` for internal errors
- Don't try to fix type issues by casting to unknown or any. If you need to do this, then stop and ask me to manually intervene.
- Write log messages in lowercase
- Use `logger()` to log messages
    - Do not store `logger()` as a variable, always call it using `logger().info("...")`
    - Use structured logging where it makes sense, for example: `logger().info("foo", { bar: 5, baz: 10 })`
    - Supported logging methods are: trace, debug, info, warn, error, critical
- Instead of returning errors as raw HTTP responses with c.json, use or write an error in packages/rivetkit/src/actor/errors.ts and throw that instead. The middleware will automatically serialize the response for you.

## Project Structure

- Monorepo with pnpm workspaces and Turborepo
- Core code in `packages/core/`
- Platform implementations in `packages/platforms/`
- Driver implementations in `packages/drivers/`

## Development Notes

- Use zod for runtime type validation
- Use `assertUnreachable(x: never)` for exhaustive type checking in switch statements
- Add proper JSDoc comments for public APIs
- Ensure proper error handling with descriptive messages
- Run `pnpm check-types` regularly during development to catch type errors early. Prefer `pnpm check-types` instead of `pnpm build`.
- Use `tsx` CLI to execute TypeScript scripts directly (e.g., `tsx script.ts` instead of `node script.js`).
- Do not auto-commit changes

## Test Guidelines

- Do not check if errors are an instanceOf ActorError in tests. Many error types do not have the same prototype chain when sent over the network, but still have the same properties so you can safely cast with `as`.

## Examples

Examples live in the `examples/` folder.

### Example Configuration

- All examples should have the turbo.json:

    ```json
    {
      "$schema": "https://turbo.build/schema.json",
      "extends": ["//"]
    }
    ```

### `examples/*/package.json`

- Always name the example `example-{name}`
- Always use `workspace:*` for dependencies
- Use `tsx` unless otherwise instructed
- Always have a `dev` and `check-types` scripts
    - `dev` should use `tsx --watch` unless otherwise instructed
    - `check-types` should use `tsc --noEmit`

### `examples/*/README.md`

Always include a README.md. The `README.md` should always follow this structure:

    ```md
    # {human readable title} for RivetKit

    Example project demonstrating {specific feature} with [RivetKit](https://rivetkit.org).

    [Learn More →](https://github.com/rivet-gg/rivetkit)

    [Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

    ## Getting Started

    ### Prerequisites

    - {node or bun based on demo}
    - {any other related services if this integrates with external SaaS}

    ### Installation

    ```sh
    git clone https://github.com/rivet-gg/rivetkit
    cd rivetkit/examples/{name}
    npm install
    ```

    ### Development

    ```sh
    npm run dev
    ```

    {instructions to either open browser or run script to test it}

    ## License

    Apache 2.0
    ```

## Test Notes

- Using setTimeout in tests & test actors will not work unless you call `await waitFor(driverTestConfig, <ts>)`
- Do not use setTimeout in tests or in actors used in tests unless you explictily use `await vi.advanceTimersByTimeAsync(time)`