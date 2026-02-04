# dzx CLI

Use `dzx` to develop, inspect, validate, and build MCP servers.

## Common usage

```bash
# local dev server
pnpm dzx dev

# inspect discovered tools/resources/prompts
pnpm dzx inspect --json

# validate manifest and directories
pnpm dzx validate

# build deployable output
pnpm dzx build --split-tools
```

If dzx is not installed in the project, use `npx dzx`.

## Commands

### `dzx dev`

Run a local MCP server with hot reload.

Flags:
- `--config <path>` manifest path (default: `mcp.json`)
- `--cwd <path>` working directory (default: `.`)
- `--port <number>` server port (default: `3333`)
- `--no-watch` disable file watching
- `--poll` use polling for file watching
- `--quiet` minimal output
- `--verbose` debug output

Notes:
- For Node runtime with a `.ts` entrypoint, `tsx` must be installed.
- For Deno runtime, `deno run --watch --allow-read` is used in dev, plus `--allow-net` if `permissions.network` is true.

### `dzx inspect`

Print discovered tools/resources/prompts.

Flags:
- `--config <path>` manifest path (default: `mcp.json`)
- `--cwd <path>` working directory (default: `.`)
- `--format <table|json>` output format (default: `table`)
- `--json` shorthand for JSON output

### `dzx validate`

Validate `mcp.json` and directory layout.

Flags:
- `--config <path>` manifest path (default: `mcp.json`)
- `--cwd <path>` working directory (default: `.`)
- `--strict` fail if optional directories are missing

### `dzx build`

Bundle tools and emit `tool-manifest.json`.

Flags:
- `--config <path>` manifest path (default: `mcp.json`)
- `--cwd <path>` working directory (default: `.`)
- `--out-dir <path>` output directory (default: `dist`)
- `--split-tools` emit one bundled file per tool
- `--bundle` bundle tools without splitting
- `--format <esm|cjs>` output module format (default: `esm`)
- `--sourcemap` emit sourcemaps
- `--minify` minify output

### `dzx init`

Initialize a dzx repo in the current directory.

Flags:
- `--dir <path>` target directory (default: `.`)
- `--template <basic|tools-only|full>` template to scaffold
- `--runtime <node|deno>` runtime to configure
- `--install` install dependencies after scaffolding
- `--no-install` skip dependency installation
- `--yes` accept defaults
- `--force` overwrite existing files

### `create-dzx` (via @dwizi/create-dzx)

Scaffold a new repo in a new directory. Alias of `dzx init` in scaffold mode.

Usage:

```bash
npx @dwizi/create-dzx@latest
```

Flags:
- `--dir <path>` target directory (default: `my-agent`)
- `--template <basic|tools-only|full>` template to scaffold
- `--runtime <node|deno>` runtime to configure
- `--install` install dependencies after scaffolding
- `--no-install` skip dependency installation
- `--yes` accept defaults
- `--force` overwrite existing files

## Environment variables

- `DZX_ENV` or `NODE_ENV` controls which `.env` files are loaded in dev.
- `DZX_LOG_LEVEL` supports `quiet`, `info`, `verbose`.
- `DZX_TOOL_TIMEOUT_MS` sets tool timeout in ms (default: 30000).
- `DZX_POLLING=1` enables polling-based watch mode.
- `DZX_SOCKET` overrides the Unix socket path (dev fallback).
- `DZX_HOST` overrides the bind address.

## .env loading order (dev)

1. `.env`
2. `.env.local`
3. `.env.<mode>`
4. `.env.<mode>.local`

Existing `process.env` values take precedence.
