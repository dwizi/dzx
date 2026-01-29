# dzx Architecture

This document explains how dzx is organized and how the main flows work.

## Design Principles
- **MCP-first**: expose tools/resources/prompts with clear schemas.
- **Single manifest**: `mcp.json` is the source of truth for runtime + build.
- **Runtime-agnostic core**: shared logic for discovery and schema validation.
- **Predictable outputs**: deterministic `tool-manifest.json` for gateway import.

## Package Layout
```
packages/dzx/
  src/
    cli/           # Node CLI commands (dev/inspect/validate/build)
    core/          # manifest, discovery, env, schema inference
    runtime/       # local MCP server runtime
    schema/        # defineSchema helper
    testing/       # in-process testing SDK
    shared/        # shared helpers (version)
  templates/       # create-dzx templates
  scripts/         # build + smoke test
  mcp.schema.json
  tool-manifest.schema.json
```

## Core Flow: `dzx dev`
1) Load `mcp.json` (validate + normalize).
2) Discover tools/resources/prompts.
3) Spawn runtime entrypoint with dev flags.
4) Watch for changes in tools/resources/prompts and `.env.*`.
5) Restart the runtime on changes.

## Core Flow: `dzx build`
1) Load + validate manifest.
2) Run optional `build.command`.
3) Bundle tools (split per tool or bundle-only).
4) Copy resources/prompts into the output dir.
5) Emit `tool-manifest.json` used by the dwizi import pipeline.

## Runtime (HTTP + JSON-RPC)
- POST `/mcp/<name>` for JSON-RPC requests.
- `?stream=1` or `Accept: text/event-stream` enables SSE.
- Implements method aliases for client compatibility (`tools.list` → `tools/list`).
- Validates input/output against schemas before/after tool execution.

## Schema Sources (priority order)
1) `export const schema = { input, output }`
2) JSDoc inference (`@param`, `@returns`)
3) Function signature inference
4) Default permissive schema

## Testing SDK
`@dwizi/dzx/testing` spins up an in-process server without HTTP, so tests can call
`tools/call` and other methods directly.

## Build Output
`tool-manifest.json` includes:
- app metadata (name/version/entry)
- runtime + permissions
- tools with bundled file paths + schemas
- resources/prompts with file paths

## Reference Docs
- `README.md` overview and usage
- `CLI.md` command reference
- `CORE.md` proposed long-term core layout
