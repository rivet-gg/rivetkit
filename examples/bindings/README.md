---
title: "Bindings"
description: "Expose trusted host functions to embedded VMs as Zod-typed commands."
category: "Reference"
order: 3
---

Give embedded VM programs access to trusted host code—API calls, database lookups, and internal services—through type-safe inputs and an auto-generated CLI surface.

## How it works

A binding collection bundles a `name`, a `description`, and a map of named `bindings`. Each binding declares a Zod `inputSchema`, an `execute` handler that runs on the host, and optional `examples`. Pass collections to `AgentOs.create({ bindings: [...] })`; agentOS exposes each collection as `/usr/local/bin/agentos-{name}` inside the VM. The hosted actor intentionally does not expose bindings because its guest cannot be trusted with host capabilities.

## Run it

```sh
npm install
WEATHER_API_KEY=... npx tsx exec-bash.ts
```

The guest command calls the `weather` binding and writes the host-side result into the VM filesystem.

## Source

View the source on GitHub: https://github.com/rivet-dev/agent-os/tree/main/examples/bindings
