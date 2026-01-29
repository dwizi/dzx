# Manifest (mcp.json)

`mcp.json` is the source of truth for a dzx MCP repo.

## Minimal example
```json
{
  "name": "weather-tools",
  "version": "0.1.0",
  "runtime": "node",
  "entry": "src/server.ts"
}
```

## Fields
- `name` (string, required)
- `version` (string, required)
- `runtime` ("node" | "deno", required)
- `entry` (string, required) — relative path to server entry.
- `protocolVersion` (string, optional)
- `toolsDir` (string, optional, default: `tools`)
- `resourcesDir` (string, optional, default: `resources`)
- `promptsDir` (string, optional, default: `prompts`)
- `permissions` (object, optional)
  - `network` (boolean)
  - `filesystem.read` (string[])
  - `filesystem.write` (string[])
- `build` (object, optional)
  - `command` (string)
  - `output` (string)
  - `env` (record<string, string>)

## Rules
- `entry` must be a repo-relative path.
- If `build.command` is provided, `build.output` must also be provided.
- Optional directories must be repo-relative.

## JSON Schema
See `mcp.schema.json` for the full schema.
