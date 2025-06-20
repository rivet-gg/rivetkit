# Rivet Platform for RivetKit

Example project demonstrating Rivet cloud platform deployment with [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js
- Rivet CLI (`npm install -g @rivet-gg/cli`)
- Rivet Cloud account

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/rivet
npm install
```

### Configuration

Set up your environment variables:

```sh
export RIVET_ENDPOINT=https://api.rivet.gg
export RIVET_SERVICE_TOKEN=your_service_token
export RIVET_PROJECT=your_project_id
export RIVET_ENVIRONMENT=your_environment
```

### Development

```sh
npm run dev
```

### Deployment

Deploy to Rivet Cloud:

```sh
rivet deploy
```

Your RivetKit workers will be deployed as Rivet actors with automatic scaling and management.

## License

Apache 2.0
