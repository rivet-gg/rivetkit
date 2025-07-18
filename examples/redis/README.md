# Redis Example for RivetKit

Example project demonstrating Redis persistence and coordinate topology with [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 18+
- Redis server running on localhost:6379 (or configure connection)

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/redis
npm install
```

### Development

Start Redis server (if not already running):
```sh
redis-server
```

Start the RivetKit server:
```sh
npm run dev
```

In another terminal, run the client demo:
```sh
npm run client
```

## Configuration

The example uses Redis with coordinate topology, which provides:
- **Persistence**: Actor state is stored in Redis
- **Coordination**: Multiple server instances can coordinate through Redis
- **Scalability**: Actors can migrate between nodes based on load

### Environment Variables

- `REDIS_HOST`: Redis server host (default: localhost)
- `REDIS_PORT`: Redis server port (default: 6379)
- `REDIS_PASSWORD`: Redis password (if required)
- `REDIS_DB`: Redis database number (default: 0)

### Example with custom Redis configuration:

```sh
REDIS_HOST=redis.example.com REDIS_PORT=6380 REDIS_PASSWORD=secret npm run dev
```

## Features Demonstrated

- **Redis Actor Driver**: Persists actor state in Redis
- **Redis Manager Driver**: Handles actor discovery and routing
- **Redis Coordinate Driver**: Enables peer-to-peer coordination between nodes
- **State Persistence**: Counter state survives server restarts
- **Action Execution**: Remote procedure calls with Redis backend
- **Broadcasting**: Events sent to connected clients

## License

Apache 2.0