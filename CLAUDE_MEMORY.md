# RivetKit Raw HTTP/WebSocket Implementation

## Overview
Raw HTTP/WebSocket support allows RivetKit actors to handle arbitrary HTTP requests and WebSocket connections outside the standard RPC protocol, enabling webhooks, file uploads, custom APIs, and real-time communication.

## TODO

- [x] Rename RivetWebSocket to UniversalWebSocket
- [x] Update all uses of `WebSocket` as a type to instead use `UniversalWebSocket` type
- [x] Add a `UniversalEventSource` and update the usage in all places `EventSource` is used, including common/eventsource.ts
- [x] Update raw-fetch-handler example to have buttons increment & refresh for both via actor fetch and via forward endpoint

## Architecture Summary

### Request Flow
```
Client → Manager Router → Actor Query → Authentication → Actor Instance → onFetch/onWebSocket
```

### Authentication Flow
1. Client sends request with actor query and connection params
2. Manager router extracts params from headers (HTTP) or subprotocols (WebSocket)
3. `authenticateEndpoint` calls actor's `onAuth` with "action" intent
4. Auth data passed to actor instance methods

### Error Handling
- `FetchHandlerNotDefined` (404) - No onFetch handler defined
- `InvalidFetchResponse` (500) - onFetch returned void/undefined
- `WebSocketHandlerNotDefined` (404) - No onWebSocket handler defined
- Errors preserve original status codes via `deconstructError`

## Key Files

### Core Implementation
- `/packages/core/src/manager/router.ts`
  - `handleRawHttpRequest()` - Main HTTP entry point, handles auth and routing
  - `handleRawWebSocketRequest()` - WebSocket entry point with subprotocol parsing
  - `parseWebSocketProtocols()` - Shared function for parsing WebSocket subprotocols
  
- `/packages/core/src/actor/instance.ts`
  - `handleFetch()` - Validates handler exists and response is returned
  - `handleWebSocket()` - Manages WebSocket lifecycle

### Client Implementation
- `/packages/core/src/client/http-client-driver.ts` - HTTP client with URL normalization
- `/packages/core/src/inline-client-driver/mod.ts` - Inline client with raw HTTP support (now with path normalization)
- `/packages/core/src/client/actor-handle.ts` - Actor handle with fetch/websocket methods
- `/packages/core/src/client/actor-conn.ts` - Actor connection with fetch/websocket methods
- `/packages/core/src/client/raw-utils.ts` - Shared utilities for raw HTTP/WebSocket operations

### Topology Support
- `/packages/core/src/topologies/standalone/topology.ts` - Direct in-process handling
- `/packages/core/src/topologies/partition/topology.ts` - Proxy-based distributed handling
- `/packages/core/src/topologies/coordinate/...` - Not yet implemented

### Supporting Files
- `/packages/core/src/actor/errors.ts` - Error definitions
- `/packages/core/src/manager/auth.ts` - `authenticateEndpoint()` function
- `/packages/core/src/common/utils.ts` - `deconstructError()` with status code support
- `/packages/core/src/manager/raw-websocket-bridge.ts` - Hono WSContext to WebSocket API adapter

### Test Files
- `/packages/core/src/driver-test-suite/tests/raw-http.ts` - Core functionality tests including Hono
- `/packages/core/src/driver-test-suite/tests/raw-http-request-properties.ts` - Request property tests
- `/packages/core/src/driver-test-suite/tests/raw-websocket.ts` - WebSocket tests with event handling
- `/packages/core/src/driver-test-suite/tests/actor-auth.ts` - Authentication tests
- `/packages/core/fixtures/driver-test-suite/raw-*.ts` - Test actor fixtures

## Test Results
All 297 tests passing, 16 skipped. The implementation is complete and ready for use.
