# Build Output

`dzx build` produces a deployable bundle and a `tool-manifest.json` file. This is the output that the gateway imports.

## Output layout

```
dist/
  tools/
  resources/
  prompts/
  tool-manifest.json
```

## Build flow

`dzx build` performs these steps:
- Loads and validates `mcp.json`.
- Runs `build.command` (if configured).
- Bundles tools (or leaves them as source).
- Copies resources and prompts.
- Generates `tool-manifest.json` with schemas and file paths.

## Bundling modes

You control tool output with flags:
- `--split-tools` bundles each tool into its own file.
- `--bundle` bundles tools into a single output format without splitting.
- If neither flag is set, tool files are copied as source and `toolFormat` is `source`.

The module format can be `esm` or `cjs` with `--format`.

## tool-manifest.json

The manifest describes what the gateway can run. Key fields:
- `manifestVersion` always `"1"`.
- `app` includes `name`, `version`, and `entry` from `mcp.json`.
- `runtime` is `node` or `deno`.
- `permissions` mirrors the manifest permissions.
- `toolFormat` is `esm`, `cjs`, or `source`.
- `tools`, `resources`, and `prompts` include file paths and metadata.

Example (trimmed):

```json
{
  "manifestVersion": "1",
  "app": { "name": "weather-tools", "version": "1.2.0", "entry": "src/server.ts" },
  "runtime": "node",
  "permissions": { "network": true, "filesystem": { "read": [], "write": [] } },
  "toolFormat": "esm",
  "tools": [
    {
      "name": "forecast",
      "description": "Fetch weather data",
      "file": "dist/tools/forecast.js",
      "format": "esm",
      "inputSchema": { "type": "object", "properties": { "city": { "type": "string" } } },
      "outputSchema": { "type": "object", "properties": { "temp": { "type": "number" } } }
    }
  ],
  "resources": [
    { "name": "getting-started", "file": "dist/resources/getting-started.md" }
  ],
  "prompts": [
    { "name": "summarize", "file": "dist/prompts/summarize.md", "inputs": [] }
  ]
}
```

## Configuring output

You can set the output folder in two places:
- `build.output` in `mcp.json`
- `dzx build --out-dir <path>` (overrides manifest)

If you set `build.command`, you must also set `build.output`.

## Schema details

The full schema for the build manifest is defined in `packages/dzx/tool-manifest.schema.json`.
