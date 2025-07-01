<div align="center">
  <a href="https://rivetkit.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./.github/media/icon-text-white.svg" alt="RivetKit" width="250">
      <img src="./.github/media/icon-text-white.svg" alt="RivetKit" width="400">
    </picture>
  </a>
  <br/>
  <br/>
  <p><b>Lightweight Libraries for Backends</b></p>
  <p>
    Install one package, scale to production.<br/>
    <u>Just a library, no SaaS.</u><br/>
  </p>
  <p>
    <i>
      Supports Rivet, Cloudflare, Node, Bun, Redis, memory, file system, TypeScript,<br/>
      Rust, React, Hono, Express, Elysia, tRPC, and Vitest.
    </i>
  </p>
  <p>
    <a href="https://rivetkit.org/">Documentation</a> •
    <a href="https://discord.gg/rivet">Discord</a> •
    <a href="https://x.com/RivetKit_org">X</a> •
    <a href="https://bsky.app/">Bluesky</a>
  </p>

</div>

## Quickstart

- <img src="docs/images/clients/javascript.svg" height="16" alt="Node.js" />&nbsp;&nbsp;[Node.js & Bun](https://rivetkit.org/actors/quickstart-backend)
- <img src="docs/images/clients/react.svg" height="16" alt="React" />&nbsp;&nbsp;[React](https://rivetkit.org/actors/quickstart-frontend)

## Examples

Browse snippets for how to use RivetKit with different use cases.

| Example | Actor (JavaScript) | Actor (SQLite) | Frontend (React) |
|---------|------------|--------|-------|
| AI Agent | [actor.ts](/examples/snippets/ai-agent/actor-json.ts) | [actor.ts](/examples/snippets/ai-agent/actor-sqlite.ts) | [App.tsx](/examples/snippets/ai-agent/App.tsx) |
| Collaborative Document (CRDT) | [actor.ts](/examples/snippets/crdt/actor-json.ts) | [actor.ts](/examples/snippets/crdt/actor-sqlite.ts) | [App.tsx](/examples/snippets/crdt/App.tsx) |
| Chat Room | [actor.ts](/examples/snippets/chat-room/actor-json.ts) | [actor.ts](/examples/snippets/chat-room/actor-sqlite.ts) | [App.tsx](/examples/snippets/chat-room/App.tsx) |
| Per-User Databases | [actor.ts](/examples/snippets/database/actor-json.ts) | [actor.ts](/examples/snippets/database/actor-sqlite.ts) | [App.tsx](/examples/snippets/database/App.tsx) |
| Rate Limiter | [actor.ts](/examples/snippets/rate/actor-json.ts) | [actor.ts](/examples/snippets/rate/actor-sqlite.ts) | [App.tsx](/examples/snippets/rate/App.tsx) |
| Stream Processing | [actor.ts](/examples/snippets/stream/actor-json.ts) | [actor.ts](/examples/snippets/stream/actor-sqlite.ts) | [App.tsx](/examples/snippets/stream/App.tsx) |
| Multiplayer Game | [actor.ts](/examples/snippets/game/actor-json.ts) | [actor.ts](/examples/snippets/game/actor-sqlite.ts) | [App.tsx](/examples/snippets/game/App.tsx) |
| Local-First Sync | [actor.ts](/examples/snippets/sync/actor-json.ts) | [actor.ts](/examples/snippets/sync/actor-sqlite.ts) | [App.tsx](/examples/snippets/sync/App.tsx) |

_SQLite will be available in July._

## Runs On Your Stack

Deploy RivetKit anywhere - from serverless platforms to your own infrastructure. Don't see the runtime you want? [Add your own](http://localhost:3000/drivers/build).

### All-In-One
- <img src="docs/images/platforms/rivet-white.svg" height="16" alt="Rivet" />&nbsp;&nbsp;[Rivet](/platforms/rivet)
- <img src="docs/images/platforms/cloudflare-workers.svg" height="16" alt="Cloudflare Workers" />&nbsp;&nbsp;[Cloudflare Workers](/platforms/cloudflare-workers)

### Compute
- <img src="docs/images/platforms/vercel.svg" height="16" alt="Vercel" />&nbsp;&nbsp;[Vercel](https://github.com/rivet-gg/rivetkit/issues/897) *(On The Roadmap)*
- <img src="docs/images/platforms/aws-lambda.svg" height="16" alt="AWS Lambda" />&nbsp;&nbsp;[AWS Lambda](https://github.com/rivet-gg/rivetkit/issues/898) *(On The Roadmap)*
- <img src="docs/images/platforms/supabase.svg" height="16" alt="Supabase" />&nbsp;&nbsp;[Supabase](https://github.com/rivet-gg/rivetkit/issues/905) *(Help Wanted)*
- <img src="docs/images/platforms/bun.svg" height="16" alt="Bun" />&nbsp;&nbsp;[Bun](/platforms/bun)
- <img src="docs/images/platforms/nodejs.svg" height="16" alt="Node.js" />&nbsp;&nbsp;[Node.js](/platforms/nodejs)

### Storage
- <img src="docs/images/platforms/redis.svg" height="16" alt="Redis" />&nbsp;&nbsp;[Redis](/drivers/redis)
- <img src="docs/images/platforms/postgres.svg" height="16" alt="Postgres" />&nbsp;&nbsp;[Postgres](https://github.com/rivet-gg/rivetkit/issues/899) *(Help Wanted)*
- <img src="docs/images/platforms/file-system.svg" height="16" alt="File System" />&nbsp;&nbsp;[File System](/drivers/file-system)
- <img src="docs/images/platforms/memory.svg" height="16" alt="Memory" />&nbsp;&nbsp;[Memory](/drivers/memory)

## Works With Your Tools

Seamlessly integrate RivetKit with your favorite frameworks, languages, and tools. Don't see what you need? [Request an integration](https://github.com/rivet-gg/rivetkit/issues/new).

### Frameworks
- <img src="docs/images/clients/react.svg" height="16" alt="React" />&nbsp;&nbsp;[React](/frameworks/react)
- <img src="docs/images/clients/nextjs.svg" height="16" alt="Next.js" />&nbsp;&nbsp;[Next.js](https://github.com/rivet-gg/rivetkit/issues/904) *(Help Wanted)*
- <img src="docs/images/clients/vue.svg" height="16" alt="Vue" />&nbsp;&nbsp;[Vue](https://github.com/rivet-gg/rivetkit/issues/903) *(Help Wanted)*

### Clients
- <img src="docs/images/clients/javascript.svg" height="16" alt="JavaScript" />&nbsp;&nbsp;[JavaScript](/clients/javascript)
- <img src="docs/images/clients/typescript.svg" height="16" alt="TypeScript" />&nbsp;&nbsp;[TypeScript](/clients/javascript)
- <img src="docs/images/clients/python.svg" height="16" alt="Python" />&nbsp;&nbsp;[Python](/clients/python)
- <img src="docs/images/clients/rust.svg" height="16" alt="Rust" />&nbsp;&nbsp;[Rust](/clients/rust)

### Integrations
- <img src="docs/images/integrations/hono.svg" height="16" alt="Hono" />&nbsp;&nbsp;[Hono](/integrations/hono)
- <img src="docs/images/integrations/vitest.svg" height="16" alt="Vitest" />&nbsp;&nbsp;[Vitest](/concepts/testing)
- <img src="docs/images/integrations/resend.svg" height="16" alt="Resend" />&nbsp;&nbsp;[Resend](/integrations/resend)
- <img src="docs/images/integrations/better-auth.svg" height="16" alt="Better Auth" />&nbsp;&nbsp;[Better Auth](https://github.com/rivet-gg/rivetkit/issues/906) *(On The Roadmap)*
- <img src="docs/images/platforms/vercel.svg" height="16" alt="AI SDK" />&nbsp;&nbsp;[AI SDK](https://github.com/rivet-gg/rivetkit/issues/907) *(On The Roadmap)*

### Local-First Sync
- <img src="docs/images/integrations/livestore.svg" height="16" alt="LiveStore" />&nbsp;&nbsp;[LiveStore](https://github.com/rivet-gg/rivetkit/issues/908) *(Available In July)*
- <img src="docs/images/integrations/zerosync.svg" height="16" alt="ZeroSync" />&nbsp;&nbsp;[ZeroSync](https://github.com/rivet-gg/rivetkit/issues/909) *(Help Wanted)*
- <img src="docs/images/integrations/tinybase.svg" height="16" alt="TinyBase" />&nbsp;&nbsp;[TinyBase](https://github.com/rivet-gg/rivetkit/issues/910) *(Help Wanted)*
- <img src="docs/images/integrations/yjs.svg" height="16" alt="Yjs" />&nbsp;&nbsp;[Yjs](https://github.com/rivet-gg/rivetkit/issues/911) *(Help Wanted)*

## Join the Community

Help make RivetKit the universal way to build & scale stateful serverless applications.

- [Discord](https://rivet.gg/discord)
- [X](https://x.com/RivetKit_org)
- [Bluesky](https://bsky.app/profile/rivet.gg)
- [Discussions](https://github.com/rivet-gg/rivetkit/discussions)
- [Issues](https://github.com/rivet-gg/rivetkit/issues)

## License

Apache 2.0

_Scale without drama – only with Rivet Actors._

