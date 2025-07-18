# Redis + Hono Example for RivetKit

Example project demonstrating Redis persistence with Hono web framework and [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 18+
- Redis server running on localhost:6379 (or configure connection)

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/redis-hono
npm install
```

### Development

Start Redis server (if not already running):
```sh
redis-server
```

Start the RivetKit + Hono server:
```sh
npm run dev
```

In another terminal, run the client demo:
```sh
npm run client
```

Open http://localhost:8088 in your browser to see the API documentation.

## API Endpoints

### Counter API
- `POST /counter/:name/increment` - Increment counter (body: `{amount?: number}`)
- `GET /counter/:name` - Get counter value
- `POST /counter/:name/reset` - Reset counter to 0

### Chat API
- `POST /chat/:room/message` - Send message (body: `{user: string, text: string}`)
- `GET /chat/:room/messages` - Get room messages
- `GET /chat/:room/users` - Get user count in room

### System
- `GET /health` - Health check
- `GET /` - API documentation

## Example Usage

```bash
# Increment a counter
curl -X POST http://localhost:8088/counter/mycounter/increment \
  -H 'Content-Type: application/json' \
  -d '{"amount": 5}'

# Get counter value
curl http://localhost:8088/counter/mycounter

# Send a chat message
curl -X POST http://localhost:8088/chat/general/message \
  -H 'Content-Type: application/json' \
  -d '{"user": "Alice", "text": "Hello world!"}'

# Get chat messages
curl http://localhost:8088/chat/general/messages

# Health check
curl http://localhost:8088/health
```

## Configuration

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

- **Redis Persistence**: All actor state persisted in Redis
- **Coordinate Topology**: Multi-node coordination through Redis
- **HTTP API**: RESTful endpoints with Hono framework
- **Real-time State**: Actor state changes broadcast to connected clients
- **Multiple Actors**: Counter and chat room actors in same application
- **Error Handling**: Proper error responses and health checks
- **Connection Management**: User count tracking in chat rooms

## Architecture

This example shows how to build a production-ready API with RivetKit:

1. **RivetKit Core**: Handles actor lifecycle and state management
2. **Redis Drivers**: Persist state and coordinate between server instances
3. **Hono Framework**: Fast HTTP server with clean routing
4. **Actor Pattern**: Encapsulated business logic with actions and events

The coordinate topology allows you to run multiple server instances that will automatically coordinate through Redis, providing horizontal scalability.

## License

Apache 2.0