# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation Project

This is the documentation site for RivetKit built with Mintlify. The documentation covers RivetKit's actor-based stateful serverless framework and related integrations.

## Documentation Structure

- **actors/**: Core actor system documentation (state, actions, events, scheduling)
- **clients/**: Client libraries for JavaScript/TypeScript, React, Rust
- **drivers/**: Storage drivers (Memory, File System, Redis, Cloudflare Workers, Rivet)
- **general/**: Architecture, authentication, testing, logging, CORS
- **integrations/**: Framework integrations (Hono, Express, Elysia, tRPC, Better Auth, Vitest)
- **snippets/**: Reusable content components for landing page

## Key Documentation Files

- `docs.json`: Mintlify configuration with navigation structure

## Documentation Style Guide

### File Structure
- Use `.mdx` extension for all documentation files
- Include frontmatter with `title`, `description`, and `sidebarTitle`
- Use `icon` field for navigation icons (from Font Awesome icon set)

### Content Guidelines
- **Concise and Direct**: Keep explanations brief and actionable
- **Code-First**: Lead with practical examples, then explain concepts
- **Use Cases Focus**: Emphasize practical applications over theoretical details
- **Progressive Disclosure**: Start simple, link to detailed guides

### Code Examples
- Use TypeScript for all code examples
- Show complete, runnable examples when possible
- Include both actor and client code where relevant
- Follow RivetKit naming conventions (`actor`, `c` for context, etc.)

### Navigation
- Group related concepts under clear categories
- Use descriptive but short sidebar titles
- Maintain consistent icon usage for categories

## Development Resources

- Refer to ../packages/core/fixtures/driver-test-suite/*.ts for examples of working actor definitions
- Refer to ../examples/* for fully working projects. This is especially helpful when writing guides for integrations, etc.
