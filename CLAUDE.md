# ActorCore Development Guide

## Project Naming

- Use `ActorCore` when referring to the project in documentation and plain English
- Use `actor-core` (kebab-case) when referring to the project in code, package names, and imports

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

- **Type Check:** `yarn check-types` - Verify TypeScript types
- **Check specific package:** `yarn check-types -F actor-core` - Check only specified package
- **Build:** `yarn build` - Production build using Turbopack
- **Build specific package:** `yarn build -F actor-core` - Build only specified package
- **Format:** `yarn fmt` - Format code with Biome

## Core Concepts

### Topologies

Actor-Core supports three topologies that define how actors communicate and scale:

- **Singleton:** A single instance of an actor running in one location
- **Partition:** Multiple instances of an actor type partitioned by ID, useful for horizontal scaling 
- **Coordinate:** Actors connected in a peer-to-peer network, sharing state between instances

### Driver Interfaces

Driver interfaces define the contract between Actor-Core and various backends:

- **ActorDriver:** Manages actor state, lifecycle, and persistence
- **ManagerDriver:** Manages actor discovery, routing, and scaling
- **CoordinateDriver:** Handles peer-to-peer communication between actor instances

### Driver Implementations

Located in `packages/drivers/`, these implement the driver interfaces:

- **Memory:** In-memory implementation for development and testing
- **Redis:** Production-ready implementation using Redis for persistence and pub/sub

### Platforms

Located in `packages/platforms/`, these adapt Actor-Core to specific runtime environments:

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
  - Extend from `ActorError` base class
  - Use `UserError` for client-safe errors
  - Use `InternalError` for internal errors

## Project Structure

- Monorepo with Yarn workspaces and Turborepo
- Core code in `packages/actor-core/`
- Platform implementations in `packages/platforms/`
- Driver implementations in `packages/drivers/`

## Development Notes

- Prefer classes over factory functions
- Use zod for runtime type validation
- Use `assertUnreachable(x: never)` for exhaustive type checking in switch statements
- Follow existing patterns for P2P networking
- Add proper JSDoc comments for public APIs
- Ensure proper error handling with descriptive messages
- Run `yarn check-types` regularly during development to catch type errors early. Prefer `yarn check-types` instead of `yarn build`.
- Use `tsx` CLI to execute TypeScript scripts directly (e.g., `tsx script.ts` instead of `node script.js`).
- Do not auto-commit changes