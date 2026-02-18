# Dzx

Dzx is the open framework for building MCP servers on Dwizi. It standardizes repo structure, tool/resource/prompt discovery, and runtime configuration for Node and Deno.

**Runtime requirements:** Node.js 24+ (ESM-first).

## Getting Started

**New to dzx?** Start with the [Getting Started Guide](docs/getting-started.md) for a comprehensive introduction covering:
- Why dzx and when to use it
- Quick start tutorial
- Understanding Build vs Dev vs Runtime modes
- Project structure and common questions

**Quick scaffold:**
```bash
npx @dwizi/create-dzx@latest
```

`create-dzx` is an alias of `dzx init` (scaffold mode) so the entire setup ships from the same codebase.

## Repo Layout
```
.
├─ mcp.json
├─ tools/
│  └─ *.ts
├─ resources/
│  └─ *.md
├─ prompts/
│  └─ *.md
└─ src/
   └─ server.ts
```

## Runtime & CLI Architecture
- Shared core: manifest parsing, discovery, and bundling logic.
- Node CLI: `@dwizi/dzx` (dev/inspect/validate/build).
- Deno CLI: `@dwizi/dzx-deno` (same commands, Deno runtime).

## Package Structure (dzx)
```
packages/dzx/
  src/        core + runtime + CLI
  templates/  create-dzx templates
  scripts/    build + smoke test
  mcp.schema.json
  tool-manifest.schema.json
```

## Dev logs & env loading
`dzx dev` prints request + tool logs by default. Use `--quiet` to minimize output or `--verbose` to include RPC + structured output logs.

Environment files are loaded in this order:
1. `.env`
2. `.env.local`
3. `.env.<mode>`
4. `.env.<mode>.local`

`mode` is `development` by default (or `NODE_ENV` / `DZX_ENV`). Existing `process.env` values override file values.

Dev dashboard:
- Visit `http://localhost:3333/` to see a simple local dashboard with endpoints and tool/resource/prompt lists.

Timeouts:
- `DZX_TOOL_TIMEOUT_MS` sets the tool execution timeout (default: 30000ms).

## mcp.json
The manifest defines runtime, entrypoint, and permissions. See `mcp.schema.json` for the full schema.

Minimal example:
```json
{
  "name": "weather-tools",
  "version": "0.1.0",
  "runtime": "node",
  "entry": "src/server.ts",
  "toolsDir": "tools",
  "resourcesDir": "resources",
  "promptsDir": "prompts",
  "permissions": {
    "network": false,
    "filesystem": { "read": ["./resources", "./prompts"], "write": [] }
  }
}
```

### Validation rules (summary)
- `name`, `version`, `runtime`, and `entry` are required.
- `runtime` must be `node` or `deno`.
- `entry` must be a relative path within the repo.
- `toolsDir`, `resourcesDir`, `promptsDir` must be relative paths.
- `permissions.filesystem.read/write` are path allowlists; default is no write access.
- `build.command` is optional; if present, `build.output` must be provided.

## Tool Discovery
Tools are discovered from `tools/` as **default exports**. Tool names come from the file path (for example, `tools/smart-hello.ts` → `smart-hello`).

### Build Output
`dzx build` produces:
- `dist/tools/*` bundled tool files (per-tool or bundled)
- `dist/resources/*` copied resources
- `dist/prompts/*` copied prompts
- `dist/tool-manifest.json` manifest used by the dwizi import flow

### Dev Watch Mode
If your system hits file descriptor limits, enable polling:
```
dzx dev --poll
```

### Socket-less Dev Mode (EPERM)
Some sandboxed environments block TCP listeners and raise `EPERM`. In dev, dzx
falls back to a Unix socket (default: `/tmp/dzx-<name>.sock`). If sockets are
also blocked, it keeps the process alive without listening and prints a warning.

You can control the socket path with:
```
DZX_SOCKET=/tmp/dzx.sock dzx dev
```

### Protocol Version
If your MCP client expects a specific protocol version, set it in `mcp.json`:
```
{
  "protocolVersion": "2025-11-25"
}
```

### Optional MCP Methods
You can opt in to additional MCP methods in `mcp.json`:
```
{
  "mcp": {
    "methods": {
      "resourcesTemplatesList": true,
      "completionComplete": true,
      "notificationsComplete": true
    }
  }
}
```

### Client Compatibility
dzx accepts both slash and dotted method names and supports SSE streaming.

Supported methods:
- `initialize` (returns tools/resources/prompts and `protocolVersion`)
- `notifications/initialized`
- `tools/list`, `tools/call` (also `tools.list`, `tools.call`)
- `resources/list`, `resources/read`, `resources/subscribe`, `resources/unsubscribe`
- `prompts/list`, `prompts/get`
- `logging/setLevel`, `notifications/cancelled`, `notifications/canceled`
- Optional: `resources/templates/list`
- Optional: `completion/complete`
- Optional: `notifications/complete`, `notifications/completed`

Streaming:
- Add `?stream=1` or `Accept: text/event-stream` to get SSE (`event: message`).

### Recommended (Zod-first)
Install Zod in your MCP repo:
```
pnpm add zod
```

```ts
import { z } from "zod";
import { defineSchema } from "@dwizi/dzx/schema";

/**
 * Adds two numbers.
 */
export default async function add(input: { a: number; b: number }) {
  return { sum: input.a + input.b };
}

export const schema = {
  input: defineSchema(z.object({
    a: z.number(),
    b: z.number()
  })),
  output: defineSchema(z.object({
    sum: z.number()
  }))
};
```

### Standard (JSON Schema)
```ts
/**
 * Adds two numbers.
 */
export default async function add(input: { a: number; b: number }) {
  return { sum: input.a + input.b };
}

export const schema = {
  input: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"]
  },
  output: {
    type: "object",
    properties: { sum: { type: "number" } }
  }
};
```

### Automatic Schema Inference (JSDoc)
If you don't export a schema, `dzx` infers it from JSDoc `@param` tags.

```ts
/**
 * Multiply two numbers.
 * @param {object} input
 * @param {number} input.a
 * @param {number} [input.b] Optional multiplier
 */
export default async function multiply(input) {
  // ...
}
```
This generates a JSON Schema with `a` (required) and `b` (optional).

### Schema Requirements
Schemas are always produced for the tool manifest and runtime validation.
- If you export `schema`, it will be used directly.
- Otherwise, dzx infers schemas from JSDoc (`@param`, `@returns`).
- If JSDoc is missing, dzx infers from the function signature (typed params or destructured params).
- If inference finds nothing, dzx falls back to permissive schemas:
  - Input: `{ type: "object", properties: {}, additionalProperties: true }`
  - Output: `{ type: "object", properties: {}, additionalProperties: true }`

### Custom Validators (Joi/Yup/etc.)
`dzx` is library-agnostic. If your schema object implements `.parse()` or `.validate()`, runtime validation will use it. If it also implements `.toJSONSchema()`, discovery and tooling will expose it to LLMs.

## Context Middleware
You can inject a request-scoped context (e.g., authentication, database connections) into all tools.

1. Create `src/context.ts` (or `.js`):
   ```ts
   import type { IncomingMessage } from "http";

   export default function createContext(req: IncomingMessage) {
     return {
       user: req.headers["x-user-id"],
       db: process.env.DB_URL
     };
   }
   ```

2. Access context in your tool (2nd argument):
   ```ts
   export default async function myTool(args, context) {
     console.log(context.user); // Access injected context
   }
   ```

## Testing SDK
`dzx` provides a Testing SDK to verify your tools and context in-process (without spinning up a full HTTP server).

```ts
import { createTestServer } from "@dwizi/dzx/testing";
import assert from "node:assert";

// 1. Initialize server
const client = await createTestServer({ cwd: process.cwd() });

// 2. Call tool with arguments and optional mock context
const result = await client.callTool("myTool", { a: 1 }, { user: "TestUser" });

assert.equal(result.sum, 2);
```

## Resources
Resources are Markdown files in `resources/`. File name is the default resource name.

Optional frontmatter:
```
---
name: getting-started
description: Quick start guide
---
# Getting Started
...
```

## Prompts
Prompts are Markdown files in `prompts/` with optional frontmatter.

```
---
name: summarize
description: Summarize text in 3 bullets
inputs:
  - name: text
    type: string
---
Summarize the following:
{{text}}
```

## Planned CLI
- `dzx dev` local MCP server
- `dzx inspect` list tools/resources/prompts
- `dzx validate` validate `mcp.json`
- `dzx build` produce deployable bundle

## create-dzx
Scaffolds a new MCP repo with a template.

Example:
```bash
npx @dwizi/create-dzx@latest --template basic
```

By default it installs dependencies. Use `--no-install` to skip.

For manual setup in an existing directory:
```bash
dzx init --template basic --force
```

## Publish (Checklist)
Before publishing to npm as `@dwizi/dzx`:
- `pnpm --filter @dwizi/dzx test`
- `pnpm --filter @dwizi/dzx build`
- `pnpm -C packages/dzx publish --dry-run`
- `pnpm -C packages/dzx publish --access public`

## Additional Docs
- `docs/getting-started.md` — **Start here**: comprehensive getting started guide
- `docs/README.md` — documentation index
- `CLI.md` — command and flag matrix
- `ARCHITECTURE.md` — design + flow overview
- `CORE.md` — shared core layout
- `tool-manifest.schema.json` — build output schema
- `examples/tool-manifest.json` — example manifest

## License
MIT (see root `LICENSE`).
