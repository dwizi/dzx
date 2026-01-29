# dzx CLI

## Commands

### `dzx dev`
Run a local MCP server with hot reload.

Key flags:
- `--config <path>` manifest path (default: `mcp.json`)
- `--cwd <path>` working directory (default: `.`)
- `--port <number>` server port (default: `3333`)
- `--no-watch` disable file watching
- `--poll` use polling for file watching
- `--quiet` minimal output
- `--verbose` debug output

### `dzx inspect`
Print discovered tools, resources, and prompts.

Key flags:
- `--format <table|json>`
- `--json` shorthand for JSON output

### `dzx validate`
Validate `mcp.json` and directory layout.

Key flags:
- `--strict` fail if optional dirs are missing

### `dzx build`
Bundle tools and emit `tool-manifest.json`.

Key flags:
- `--out-dir <path>` (default: `dist`)
- `--split-tools` emit one bundled file per tool
- `--bundle` bundle tools without splitting
- `--format <esm|cjs>` (default: `esm`)
- `--sourcemap` emit sourcemaps
- `--minify` minify output

### `dzx init`
Initialize a repo in the current directory.

Key flags:
- `--template <basic|tools-only|full>`
- `--runtime <node|deno>`
- `--yes` accept defaults
- `--force` overwrite existing files

### `create-dzx`
Scaffold a new repo in a new directory. Alias of `dzx init` (scaffold mode).

Key flags:
- `--dir <path>`
- `--template <basic|tools-only|full>`
- `--runtime <node|deno>`
- `--yes`
- `--no-install`
- `--install`

## Environment
- `DZX_ENV` or `NODE_ENV` controls env file selection.
- `DZX_LOG_LEVEL` supports `quiet|info|verbose`.
- `DZX_TOOL_TIMEOUT_MS` sets tool timeout in ms.
- `DZX_POLLING=1` enables polling-based watch mode.
- `DZX_SOCKET` overrides the Unix socket path.
