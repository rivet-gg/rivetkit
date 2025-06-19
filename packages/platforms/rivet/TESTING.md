# Testing

The `RIVET_CLOUD_TOKEN` and other `RIVET_*` env vars are required to run tests.

```
export RIVET_CLOUD_TOKEN=xxxxx
# If not using Rivet Cloud
export RIVET_ENDPOINT=http://localhost:8080
rivet shell
pnpm test
```

