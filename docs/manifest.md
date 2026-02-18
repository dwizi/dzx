# Manifest (mcp.json)

`mcp.json` is the source of truth for a dzx repo. It declares your app metadata, runtime, entrypoint, discovery locations, permissions, and build settings.

## Minimal example

```json
{
  "name": "weather-tools",
  "version": "0.1.0",
  "runtime": "node",
  "entry": "src/server.ts"
}
```

## Full example

```json
{
  "name": "weather-tools",
  "version": "1.2.0",
  "runtime": "node",
  "entry": "src/server.ts",
  "protocolVersion": "2025-11-25",
  "mcp": {
    "methods": {
      "resourcesTemplatesList": true,
      "completionComplete": true,
      "notificationsComplete": true
    }
  },
  "toolsDir": "tools",
  "resourcesDir": "resources",
  "promptsDir": "prompts",
  "permissions": {
    "network": true,
    "filesystem": {
      "read": ["./resources", "./prompts"],
      "write": ["./tmp"]
    }
  },
  "build": {
    "command": "pnpm run build-assets",
    "output": "dist",
    "env": {
      "NODE_ENV": "production"
    }
  }
}
```

## Field reference

### `name` (required)

A short slug for the MCP app.
- Pattern: `^[a-z][a-z0-9-_]*$`
- Example: `weather-tools`

### `version` (required)

Semantic version for the MCP app. Used in the build manifest and gateway import.

### `runtime` (required)

Execution runtime for the server.
- `node`
- `deno`

### `entry` (required)

Repo-relative path to your server entrypoint (usually `src/server.ts`).

### `protocolVersion` (optional)

Override the MCP protocol version returned by `initialize`. Use this if your client expects a specific version string.

### `mcp.methods` (optional)

Opt-in flags for additional MCP methods.

Fields:
- `resourcesTemplatesList` (boolean) -- enables `resources/templates/list` and returns `{ "resourceTemplates": [] }`.
- `completionComplete` (boolean) -- enables `completion/complete` and returns `{ "completion": { "values": [], "hasMore": false } }`.
- `notificationsComplete` (boolean) -- accepts `notifications/complete` as a no-op notification.

### `toolsDir`, `resourcesDir`, `promptsDir` (optional)

Customize discovery directories. Defaults:
- `toolsDir`: `tools`
- `resourcesDir`: `resources`
- `promptsDir`: `prompts`

Paths are repo-relative.

### `permissions` (optional)

Describes what the runtime is allowed to do.

Fields:
- `network` (boolean) -- allow outbound network access.
- `filesystem.read` (string[]) -- read allowlist.
- `filesystem.write` (string[]) -- write allowlist.

Defaults to no network access and empty filesystem lists.

### `build` (optional)

Configure the build step and output folder.

Fields:
- `command` (string) -- shell command to run before bundling.
- `output` (string) -- output folder (required if `command` is set).
- `env` (object) -- environment variable overrides for the build command.

You can also override the output folder with `dzx build --out-dir`.

## Rules and validation

`dzx validate` and `dzx build` enforce these rules:
- `entry` must be a repo-relative path that exists.
- `runtime` must be `node` or `deno`.
- `toolsDir`, `resourcesDir`, `promptsDir` must be repo-relative paths.
- If `build.command` is provided, `build.output` must also be provided.

## JSON schema

The full schema lives at `packages/dzx/mcp.schema.json`.
