# Better Auth with External Database for RivetKit

Example project demonstrating authentication integration with [RivetKit](https://rivetkit.org) using Better Auth and SQLite database.

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/better-auth-external-db
npm install
```

### Database Setup

Initialize the SQLite database with Better Auth tables:

```sh
npm run db:setup
```

This will create the `auth.sqlite` database file with the required tables for user authentication.

### Development

```sh
npm run dev
```

Open your browser to `http://localhost:5173` to see the frontend and the backend will be running on `http://localhost:8080`.

## Features

- **Authentication**: Email/password authentication using Better Auth
- **Protected Actors**: RivetKit actors with authentication via `onAuth` hook
- **Real-time Chat**: Authenticated chat room with real-time messaging
- **External Database**: Shows how to configure Better Auth with external database (SQLite example)

## How It Works

1. **Better Auth Setup**: Configured with SQLite database for persistent user storage
2. **Protected Actor**: The `chatRoom` actor uses the `onAuth` hook to verify user sessions
3. **Frontend Integration**: React components handle authentication flow and chat interface
4. **Session Management**: Better Auth handles session creation, validation, and cleanup

## Database Commands

- `npm run db:setup` - Initialize SQLite database with Better Auth tables

## Key Files

- `src/backend/auth.ts` - Better Auth configuration with SQLite database
- `src/backend/registry.ts` - RivetKit actor with authentication
- `src/frontend/components/AuthForm.tsx` - Login/signup form
- `src/frontend/components/ChatRoom.tsx` - Authenticated chat interface
- `auth.sqlite` - SQLite database file (auto-created)

## License

Apache 2.0
