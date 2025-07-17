# Routing Refactor Spec

## Prerequisites

Make breaking changes as needed. Do not worry about backwards compatibility.

## Current design

Currently, there are 3 topologies. Requests through each topology look like (specifically for actions):

Standalone:
- Manager router -> Auth & resolve actor ID -> Inline routing handler -> StandaloneTopology.getOrCreateActor() -> Direct method call on local actor instance
- Inline client -> Direct connection to local actor instance -> Executes action synchronously in same process

Coordinated:
- Manager router -> Auth & resolve actor ID -> Inline routing handler -> CoordinateTopology.publishActionToLeader() -> Message sent via coordinate driver -> Leader peer executes action -> Response flows back
- Inline client -> Routes to local topology -> Forwards to leader peer via message passing -> Waits for acknowledgment with timeout

Partition:
- Manager router -> Auth & resolve actor ID -> Custom routing handler -> Proxy request to partition URL -> Partition's Actor Router -> Executes on isolated actor instance
- Inline client -> Not used (partition uses custom routing handler that proxies to remote actor router)

## Desired design

We need to standardize all requests to have a standard HTTP interface to communicate with the actor.

Manager router:
- HTTP request arrives -> Auth & resolve actor ID -> Create standard Request object -> ManagerDriver.onFetch(actorId, request) -> Driver-specific routing (local/remote/proxy) -> Actor Router handles request -> Execute action on actor instance -> Return Response

Inline client:
- Client calls action/rpc -> Create standard Request object -> ActorDriver.sendRequest(actorId, request) -> Driver routes to actor (in-process/IPC/network) -> Actor Router handles request -> Execute on actor instance -> Return response to client

See the existing routingHandler.custom for reference on code that's similar.

## New Project Structure

Completely remove topologies and usage of topologies. Completely remove uses of topology classes and interfaces.
Remove all uses of:

- Topologies
    - Move all topology-related functionality in to manager driver
    - Any topology-specific settings are now part of the driver
    - The ManagerDriver now handles actor lifecycle
- ConnRoutingHandler and ConnectionHandlers
    - Everything behaves like ConnRoutingHandlerCustom now, by calling methods on ManagerDriver
- ConnRoutingHandlerCustom
    - sendRequest, openWebSocket, proxyRequest, and proxyWebSocket are now part of ManagerDriver

Add onFetch and onWebSocket to ManagerDriver.

All configurations should be part of ActorDriver and ManagerDriver.

Ensure that the following drivers are working:

- Memory
- File system
- Cloudflare Workers

Ignore:

- Redis (types will not pass)

Delete:

- Rivet driver (currently commented out)

Move all code for the coordinated driver to a separate package. Ignore this package for now, this will have compile errors, etc.


### Current Structure to Remove
```
packages/core/src/
├── topologies/
│   ├── standalone/
│   │   └── topology.ts
│   ├── partition/
│   │   ├── topology.ts (split into manager/actor)
│   │   └── actor.ts
│   └── coordinate/
│       ├── topology.ts
│       ├── driver.ts
│       ├── node/
│       └── peer/
├── actor/
│   ├── conn-routing-handler.ts (remove)
│   └── router-endpoints.ts (ConnectionHandlers interface - remove)
└── manager/
    └── topology.ts (remove base topology)
```

### New Structure
```
packages/core/src/
├── actor/
│   ├── driver.ts (enhanced with routing capabilities)
│   │   └── Add: sendRequest(actorId, request) method
│   ├── instance.ts (keep, minor updates)
│   ├── router.ts (new - handles actor-side request routing)
│   ├── config.ts (merge topology configs here)
│   └── errors.ts (keep)
├── manager/
│   ├── driver.ts (enhanced with lifecycle + routing)
│   │   └── Add: onFetch(actorId, request)
│   │   └── Add: onWebSocket(actorId, request, socket)
│   │   └── Add: sendRequest(actorId, request)
│   │   └── Add: openWebSocket(actorId, request)
│   │   └── Add: proxyRequest(actorId, request)
│   │   └── Add: proxyWebSocket(actorId, request, socket)
│   │   └── Add: actor lifecycle methods from topologies
│   ├── router.ts (simplified - delegates to driver)
│   └── config.ts (merge topology configs here)
├── client/
│   ├── http-client-driver.ts (update to use new routing)
│   └── inline-client-driver.ts (update to use ActorDriver.sendRequest)
├── common/
│   └── request-response.ts (new - standard Request/Response interfaces)
└── driver-test-suite/ (update tests for new architecture)

packages/drivers/memory/src/
├── manager-driver.ts (implement new routing methods)
└── actor-driver.ts (implement sendRequest)

packages/drivers/file-system/src/
├── manager-driver.ts (implement new routing methods)
└── actor-driver.ts (implement sendRequest)

packages/platforms/cloudflare-workers/src/
├── manager-driver.ts (implement new routing methods)
└── actor-driver.ts (implement sendRequest)

packages/coordinate/ (new package - move from core)
├── src/
│   ├── driver.ts
│   ├── manager-driver.ts (implements ManagerDriver)
│   ├── actor-driver.ts (implements ActorDriver)
│   ├── node/
│   ├── peer/
│   └── mod.ts
└── package.json
```

### Additional Symbols to Delete

1. **Routing Handler Types** (in `actor/conn-routing-handler.ts`):
   - `BuildProxyEndpoint` type
   - `SendRequestHandler` type (duplicate in partition/topology.ts)
   - `OpenWebSocketHandler` type (duplicate in partition/topology.ts)
   - `ProxyRequestHandler` type
   - `ProxyWebSocketHandler` type

2. **Configuration Types and Schemas**:
   - `Topology` enum type (in `registry/run-config.ts`)
   - `TopologySchema` (in `registry/run-config.ts`)
   - `topology` field in `DriverConfigSchema`
   - `connRoutingHandler` property in `ManagerDriver` interface

3. **Internal Types**:
   - `GlobalState` interface (in `coordinate/topology.ts`)

4. **Registry Module Logic**:
   - All topology setup logic in `registry/mod.ts` (lines 61-78 and 114-125)
   - Topology exports from `topologies/mod.ts`

### Symbols to Move to Coordinate Package

1. **CoordinateDriver and Related Types**:
   - `CoordinateDriver` interface (in `topologies/coordinate/driver.ts`)
   - `NodeMessageCallback` type
   - `GetActorLeaderOutput` interface
   - `StartActorAndAcquireLeaseOutput` interface
   - `ExtendLeaseOutput` interface
   - `AttemptAcquireLease` interface

2. **Coordinate-specific Configuration**:
   - `ActorPeerConfig` and `ActorPeerConfigSchema` (in `registry/run-config.ts`)
   - `actorPeer` field in `RunConfigSchema`
   - `coordinate` field in `DriverConfigSchema`
