# Getting Started with dzx

dzx is the framework for building MCP (Model Context Protocol) servers on Dwizi. It standardizes repo structure, tool and content discovery, and the runtime that serves MCP over HTTP + JSON-RPC.

If you are used to convention-over-configuration and file-based organization, dzx will feel natural: you add files, dzx discovers them, and the runtime makes them available through MCP.

## What is MCP?

MCP is a protocol for exposing tools, resources, and prompts over a consistent JSON-RPC interface. A client can:
- Discover what tools exist.
- Call tools with structured arguments.
- Read resources (Markdown, docs, data).
- Retrieve prompts with inputs.

dzx implements the protocol and handles the details so you can focus on writing tools and content.

## Mental model

A dzx project is just a repo with three moving parts:
- `mcp.json` is the contract for your server (name, runtime, entrypoint, permissions, build output).
- Files under `tools/`, `resources/`, and `prompts/` are automatically discovered.
- `src/server.ts` boots the runtime that serves MCP requests.

The workflow is simple:
- Write tools, resources, and prompts as files.
- Run `dzx dev` for a local server with hot reload.
- Run `dzx build` to produce a deployable bundle and `tool-manifest.json`.

## Quick start

### 1. Scaffold a new repo

```bash
npx @dwizi/create-dzx@latest
```

This will:
- Ask for a runtime (`node` or `deno`).
- Ask for a template (`basic`, `tools-only`, or `full`).
- Create the folder structure and a sample tool.
- Install dependencies (skip with `--no-install`).

### 2. Start the dev server

```bash
cd your-mcp-server
pnpm dzx dev
```

The dev server starts on `http://localhost:3333` and includes:
- Hot reload on tool/resource/prompt changes.
- A local dashboard at `http://localhost:3333/`.
- Request and tool logs in your terminal.

### 3. Add your first tool

Create a new file under `tools/`. The file path becomes the tool name.

Example: `tools/user/profile.ts` becomes the tool name `user-profile`.

```ts
import { z } from "zod";
import { defineSchema } from "@dwizi/dzx/schema";

/**
 * Returns the current user profile.
 * @param {object} input
 * @param {string} input.userId
 * @returns {{ id: string, name: string }}
 */
export default async function profile(input: { userId: string }) {
  return { id: input.userId, name: "Ada" };
}

export const schema = {
  input: defineSchema(z.object({ userId: z.string() })),
  output: defineSchema(z.object({ id: z.string(), name: z.string() })),
};
```

Notes:
- Tools must export a default async function.
- Tool descriptions come from the JSDoc summary above the default export.
- If you do not export a `schema`, dzx infers schemas from JSDoc or type annotations.

### 4. Add a resource

Resources are Markdown files in `resources/`.

```md
---
name: getting-started
description: Quick overview for the assistant
---
# Getting Started
...
```

The frontmatter is optional. If omitted, dzx uses the filename as the resource name.

### 5. Add a prompt

Prompts are Markdown files in `prompts/`.

```md
---
name: summarize
description: Summarize text in three bullets
inputs:
  - name: text
    type: string
    description: The text to summarize
---
Summarize the following:
{{text}}
```

### 6. Validate and inspect

```bash
dzx validate
dzx inspect --json
```

`dzx validate` checks your manifest and directory layout. `dzx inspect` prints the discovered tools/resources/prompts.

### 7. Build for deployment

```bash
dzx build --split-tools --minify
```

This produces a `dist/` folder and a `tool-manifest.json` that the gateway can import.

## Project structure

A typical dzx project looks like this:

```
your-mcp-server/
├── mcp.json
├── tools/
│   ├── user/profile.ts
│   └── weather.ts
├── resources/
│   └── getting-started.md
├── prompts/
│   └── summarize.md
├── src/
│   └── server.ts
└── .env
```

Key files:
- `mcp.json` defines runtime, entrypoint, permissions, and build settings.
- `tools/` contains default-exported async functions.
- `resources/` contains Markdown resources.
- `prompts/` contains prompt templates with optional frontmatter.
- `src/server.ts` boots the runtime using `@dwizi/dzx/runtime`.

## Build vs dev vs runtime

dzx has three distinct modes. Understanding when to use each helps you work quickly and deploy safely.

### Development mode (`dzx dev`)

Purpose: local development with hot reload.

What it does:
- Starts your entrypoint (`src/server.ts`).
- Watches tools/resources/prompts and restarts on changes.
- Loads `.env` files (see `DZX_ENV` / `NODE_ENV`).
- Serves a local dashboard and MCP HTTP endpoints.

### Build mode (`dzx build`)

Purpose: produce deployable output.

What it does:
- Validates `mcp.json` and required paths.
- Runs an optional `build.command` if configured.
- Bundles tools (or leaves as source) and copies resources/prompts.
- Generates `tool-manifest.json` with schemas and file paths.

### Runtime mode (production)

Purpose: execute your MCP server in production.

What it does:
- Loads the built output from `dist/`.
- Enforces input/output schemas.
- Executes tools with timeouts and structured results.

## Common questions

### Do I need to install dzx globally?

No. Use `npx @dwizi/create-dzx@latest` to scaffold and `pnpm dzx` (or `npx dzx`) to run commands.

### Can I use TypeScript?

Yes. For Node runtime, dev mode uses `tsx` for `.ts` entrypoints. For Deno runtime, TypeScript is native.

### How do I inject auth or request context?

Create `src/context.ts` (or `context.ts`) and export a default function. The return value is passed as the second argument to every tool.

### How do I customize build steps?

Add `build.command` and `build.output` in `mcp.json`. The command runs before bundling and can prepare assets.

## Next steps

- Read `docs/mcp-basics.md` for a protocol-level primer.
- Read `docs/tools-resources-prompts.md` for authoring conventions.
- Read `docs/manifest.md` for the full `mcp.json` schema.
- Read `docs/runtime.md` to understand MCP endpoints and responses.
- Read `docs/cli.md` for CLI flags and environment variables.
- Read `docs/testing.md` to test tools in-process.
