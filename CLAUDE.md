# RivetKit Development Guide

## Project Naming

- Use `RivetKit` when referring to the project in documentation and plain English
- Use `rivetkit` when referring to the project in code, package names, and imports

## Common Terminology

- **Worker**: A stateful, long-lived entity that processes messages and maintains state
- **Manager**: Component responsible for creating, routing, and managing worker instances
- **Remote Procedure Call (RPC)**: Method for an worker to expose callable functions to clients
- **Event**: Asynchronous message sent from an worker to connected clients
- **Alarm**: Scheduled callback that triggers at a specific time

### Coordinated Topology Terminology

- **Peer**: Individual worker instance in a coordinated network
- **Node**: Physical or logical host running one or more worker peers

## Build Commands

- **Type Check:** `pnpm check-types` - Verify TypeScript types
- **Check specific package:** `pnpm check-types -F rivetkit` - Check only specified package
- **Build:** `pnpm build` - Production build using Turbopack
- **Build specific package:** `pnpm build -F rivetkit` - Build only specified package
- **Format:** `pnpm fmt` - Format code with Biome
- Do not run the format command automatically.

## Core Concepts

### Topologies

rivetkit supports three topologies that define how workers communicate and scale:

- **Singleton:** A single instance of an worker running in one location
- **Partition:** Multiple instances of an worker type partitioned by ID, useful for horizontal scaling 
- **Coordinate:** Workers connected in a peer-to-peer network, sharing state between instances

### Driver Interfaces

Driver interfaces define the contract between rivetkit and various backends:

- **WorkerDriver:** Manages worker state, lifecycle, and persistence
- **ManagerDriver:** Manages worker discovery, routing, and scaling
- **CoordinateDriver:** Handles peer-to-peer communication between worker instances

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
- **Imports:** Organized imports enforced, unused imports warned
- **TypeScript:** Strict mode enabled, target ESNext
- **Naming:** 
  - camelCase for variables, functions
  - PascalCase for classes, interfaces, types
  - UPPER_CASE for constants
  - Use `#` prefix for private class members (not `private` keyword)
- **Error Handling:** 
  - Extend from `WorkerError` base class
  - Use `UserError` for client-safe errors
  - Use `InternalError` for internal errors
- Don't try to fix type issues by casting to unknown or any. If you need to do this, then stop and ask me to manually intervene.
- Write log messages in lowercase
- Instead of returning raw HTTP responses with c.json, use or write an error in packages/rivetkit/src/worker/errors.ts and throw that instead. The middleware will automatically serialize the response for you.

## Project Structure

- Monorepo with pnpm workspaces and Turborepo
- Core code in `packages/rivetkit/`
- Platform implementations in `packages/platforms/`
- Driver implementations in `packages/drivers/`

## Development Notes

- Prefer classes over factory functions
- Use zod for runtime type validation
- Use `assertUnreachable(x: never)` for exhaustive type checking in switch statements
- Follow existing patterns for P2P networking
- Add proper JSDoc comments for public APIs
- Ensure proper error handling with descriptive messages
- Run `pnpm check-types` regularly during development to catch type errors early. Prefer `pnpm check-types` instead of `pnpm build`.
- Use `tsx` CLI to execute TypeScript scripts directly (e.g., `tsx script.ts` instead of `node script.js`).
- Do not auto-commit changes

## Test Guidelines

- Do not check if errors are an instanceOf WorkerError in tests. Many error types do not have the same prototype chain when sent over the network, but still have the same properties so you can safely cast with `as`.
