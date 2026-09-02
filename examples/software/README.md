---
title: "Software"
description: "Install command packages in an agentOS VM."
category: "Runtime"
order: 5
---

Software packages add commands to the guest VM. This example installs
`ripgrep` and `jq` and invokes them through the process API. The embedded
Core accepts trusted local package paths; the hosted Rust actor will expose only
remote URL sources.
