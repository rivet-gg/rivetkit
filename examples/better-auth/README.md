# Better Auth Integration for RivetKit

Example project demonstrating authentication integration with [RivetKit](https://rivetkit.org) using Better Auth.

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/better-auth
npm install
```

### Development

```sh
npm run dev
```

Open your browser to `http://localhost:5173` to see the frontend and the backend will be running on `http://localhost:8080`.

## Features

- **Authentication**: Email/password authentication using Better Auth
- **Protected Actors**: RivetKit actors with authentication via `onAuth` hook
- **Real-time Chat**: Authenticated chat room with real-time messaging
- **SQLite Database**: Persistent user data and session storage

## How It Works

1. **Better Auth Setup**: Configured with SQLite adapter for user storage
2. **Protected Actor**: The `chatRoom` actor uses the `onAuth` hook to verify user sessions
3. **Frontend Integration**: React components handle authentication flow and chat interface
4. **Session Management**: Better Auth handles session creation, validation, and cleanup

## Key Files

- `src/backend/auth.ts` - Better Auth configuration with SQLite
- `src/backend/registry.ts` - RivetKit actor with authentication
- `src/frontend/components/AuthForm.tsx` - Login/signup form
- `src/frontend/components/ChatRoom.tsx` - Authenticated chat interface

## License

Apache 2.0
