# RivetKit Development Guide

## Project Naming

- Use `RivetKit` when referring to the project in documentation and plain English
- Use `rivetkit` when referring to the project in code, package names, and imports

## `packages/**/package.json`

- Always include relevant keywords for the packages
- All packages that are libraries should depend on peer deps for: @rivetkit/*, @hono/*, hono

## `packages/**/README.md`

Always include a README.md for new packages. The `README.md` should always follow this structure:

    ```md
    # RivetKit {subname, e.g. library: RivetKit Actors, driver and platform: RivetKit Redis Adapter, RivetKit Cloudflare Workers Adapter}

    _Lightweight Libraries for Backends_

    [Learn More →](https://github.com/rivet-gg/rivetkit)

    [Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

    ## License

    Apache 2.0
    ```

[... rest of the existing content remains unchanged ...]