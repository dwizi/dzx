# dzx CLI Spec

## Commands

### `dzx init`
Initializes an MCP repo in the current directory (manual setup).

Common flags:
- `--dir <path>` target directory (default: `.`)
- `--template <basic|tools-only|full>`
- `--runtime <node|deno>`
- `--yes` accept defaults
- `--force` overwrite existing files

Notes:
- Does not require an empty directory.
- Refuses to overwrite existing files unless `--force` is provided.

---

### `dzx dev`
Runs a local MCP server with hot reload.

Common flags:
- `--config <path>`: manifest path (default: `mcp.json`)
- `--cwd <path>`: working directory (default: `.`)
- `--port <number>`: server port (default: `3333`)
- `--watch`: watch files for changes (default: true)
- `--no-watch`: disable file watching
- `--quiet`: minimal output
- `--verbose`: debug logs

Environment loading:
- Reads `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local`
- `mode` defaults to `development` (or `NODE_ENV` / `DZX_ENV`)
- Existing `process.env` values take precedence over file values

Log levels:
- `--quiet` sets `DZX_LOG_LEVEL=quiet`
- `--verbose` sets `DZX_LOG_LEVEL=verbose`
- Default is `info` (HTTP + tool logs)

Timeouts:
- `DZX_TOOL_TIMEOUT_MS` controls tool execution timeout (default: 30000ms).

Node behavior:
- Uses Node runtime and TypeScript loader (e.g. `tsx`) when needed.

Deno behavior:
- Uses `deno run` under the hood and `deno cache` for dependencies.

Current implementation notes:
- Spawns `node` or `deno` for the entrypoint.
- Node: uses `tsx` if the entrypoint is TypeScript.
- Watches files and restarts (Node only).
- If `tsx` is missing, it will error and instruct to install it.

---

### `dzx inspect`
Prints discovered tools/resources/prompts.

Common flags:
- `--config <path>`
- `--cwd <path>`
- `--format <table|json>` (default: `table`)
- `--json`: shorthand for `--format json`
- `--quiet`, `--verbose`

Expected output (table, basic template):
```
Tools
  hello  Returns a friendly greeting.

Resources
  getting-started  Quick start guide

Prompts
  summarize  Summarize text in 3 bullets
```

Expected output (json, basic template):
```json
{
  "tools": [
    {
      "name": "hello",
      "description": "Returns a friendly greeting.",
      "inputSchema": { "...": "..." },
      "outputSchema": { "...": "..." }
    }
  ],
  "resources": [
    {
      "name": "getting-started",
      "description": "Quick start guide",
      "path": "resources/getting-started.md"
    }
  ],
  "prompts": [
    {
      "name": "summarize",
      "description": "Summarize text in 3 bullets",
      "path": "prompts/summarize.md",
      "inputs": [{ "name": "text", "type": "string" }]
    }
  ]
}
```

---

### `dzx validate`
Validates `mcp.json` and directory layout.

Common flags:
- `--config <path>`
- `--cwd <path>`
- `--strict`: error on missing optional dirs
- `--quiet`, `--verbose`

Expected output (success):
```
OK  Manifest valid
OK  Tools directory: tools/
OK  Resources directory: resources/
OK  Prompts directory: prompts/
```

Expected output (error):
```
ERR Manifest: missing required field "entry"
ERR Tools directory not found: tools/
```

---

### `dzx build`
Builds a deployable bundle for dwizi.

Common flags:
- `--config <path>`
- `--cwd <path>`
- `--out-dir <path>` (default: `dist`)
- `--split-tools`: build one file per tool
- `--bundle`: bundle tool files even without split-tools
- `--format <esm|cjs>`: output module format (default: `esm`)
- `--sourcemap`: emit sourcemaps
- `--minify`
- `--quiet`, `--verbose`

Node behavior:
- Uses esbuild by default; optional tsconfig support.
- If `build.command` is present in `mcp.json`, it runs that command.
  - If `--out-dir` is omitted, `build.output` is used as the output directory.

Deno behavior:
- Uses `deno bundle` or `deno_esbuild`.
- If `build.command` is present, it runs with `deno task`.

Current implementation notes:
- Copies `tools/`, `resources/`, and `prompts/` into the output directory.
- `--split-tools` bundles tool files with esbuild (one JS file per tool file).
- Emits `tool-manifest.json` with discovered metadata + schemas.

---

## Deno CLI
- Entry: `@dwizi/dzx-deno`
- Commands and flags mirror Node CLI.

## Scaffolding
- `create-dzx` is an alias of `dzx init` in scaffold mode.
- `npx @dwizi/create-dzx@latest` prompts for runtime + template and creates a new directory.
