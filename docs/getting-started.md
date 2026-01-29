# Getting Started with dzx

**dzx** is the open framework for building MCP (Model Context Protocol) servers on Dwizi. It standardizes repo structure, tool/resource/prompt discovery, and runtime configuration for Node.js and Deno.

## Why dzx?

Building MCP servers from scratch involves a lot of boilerplate: setting up HTTP servers, parsing manifests, discovering tools, validating schemas, bundling for deployment, and more. dzx eliminates this friction.

### What dzx provides

- **Standardized structure**: Clear conventions for organizing tools, resources, and prompts
- **Zero-config discovery**: Automatic tool/resource/prompt discovery from your file structure
- **Schema-first**: Zod-first with JSON Schema fallback, plus automatic inference from JSDoc
- **Runtime parity**: Write once, run on Node.js or Deno
- **Developer experience**: Hot reload, local dashboard, and clear error messages
- **Production-ready**: Deterministic builds with deployable bundles for the dwizi gateway

### When to use dzx

- You're building MCP servers for the Dwizi platform
- You want a standardized, opinionated framework
- You need to support both Node.js and Deno runtimes
- You want automatic schema inference and validation
- You need a smooth local development experience

### When not to use dzx

- You need full control over the HTTP server implementation
- You're building a non-MCP protocol server
- You require custom discovery logic that doesn't fit dzx conventions

---

## Quick Start

### 1. Create a new MCP server

```bash
npx create-dzx@latest
```

This will:
- Prompt you to choose a runtime (`node` or `deno`)
- Prompt you to select a template (`basic`, `tools-only`, or `full`)
- Generate the project structure with a sample tool
- Install dependencies (unless you use `--no-install`)

### 2. Start the dev server

```bash
cd your-mcp-server
dzx dev
```

The server starts on `http://localhost:3333` with:
- Hot reload on file changes
- Local dashboard at `http://localhost:3333/`
- Request and tool logs in the terminal

### 3. Create your first tool

Edit `tools/hello.ts` (or create a new file in `tools/`):

```ts
import { z } from "zod";
import { defineSchema } from "@dwizi/dzx/schema";

/**
 * Returns a personalized greeting.
 */
export default async function hello(input: { name: string }) {
  return { message: `Hello, ${input.name}!` };
}

export const schema = {
  input: defineSchema(z.object({
    name: z.string().describe("The name to greet")
  })),
  output: defineSchema(z.object({
    message: z.string()
  }))
};
```

The tool is automatically discovered and available via the MCP protocol.

### 4. Test your tool

Visit `http://localhost:3333/` to see the dashboard, or use the MCP client of your choice to call `tools/call` with:

```json
{
  "method": "tools/call",
  "params": {
    "name": "hello",
    "arguments": { "name": "World" }
  }
}
```

### 5. Build for production

```bash
dzx build
```

This creates a `dist/` directory with:
- Bundled tool files
- Copied resources and prompts
- `tool-manifest.json` for dwizi import

---

## Understanding dzx: Build vs Dev vs Runtime

dzx has three distinct modes of operation. Understanding when and why to use each is key to working effectively with the framework.

### Development Mode (`dzx dev`)

**Purpose**: Local development with hot reload and debugging

**What it does**:
- Spawns your MCP server entrypoint (`src/server.ts`)
- Watches for changes in `tools/`, `resources/`, `prompts/`, and `.env.*` files
- Restarts the server automatically on changes
- Provides a local dashboard at `http://localhost:3333/`
- Loads environment variables from `.env` files
- Prints request and tool logs to the terminal

**When to use**:
- Writing and testing tools locally
- Debugging tool behavior
- Iterating on resources and prompts
- Developing with live reload

**Key characteristics**:
- **Fast iteration**: Changes are picked up immediately
- **No bundling**: Tools run directly from source (TypeScript via `tsx` for Node)
- **Development-only**: Not suitable for production deployment
- **Full debugging**: Access to source maps and original file structure

**Example workflow**:
```bash
# Terminal 1: Start dev server
dzx dev

# Terminal 2: Edit tools/my-tool.ts
# Changes are automatically picked up and server restarts
```

### Build Mode (`dzx build`)

**Purpose**: Create production-ready bundles for deployment

**What it does**:
- Validates your `mcp.json` manifest
- Runs optional `build.command` if specified
- Bundles tool files (with `--split-tools` for per-tool bundles)
- Copies resources and prompts to `dist/`
- Generates `tool-manifest.json` with tool metadata and schemas
- Produces deterministic, reproducible output

**When to use**:
- Before deploying to dwizi
- Creating a release
- Validating that everything bundles correctly
- Generating the tool manifest for gateway import

**Key characteristics**:
- **Deterministic**: Same input always produces same output
- **Optimized**: Bundled and minified (with `--minify`)
- **Self-contained**: All dependencies included in bundles
- **Gateway-ready**: Output format expected by dwizi import flow

**Example workflow**:
```bash
# Build for production
dzx build --split-tools --minify

# Output:
# dist/
#   tools/
#     hello.js
#     my-tool.js
#   resources/
#     getting-started.md
#   prompts/
#     summarize.md
#   tool-manifest.json
```

### Runtime Mode (Production)

**Purpose**: Execute your MCP server in production (dwizi gateway)

**What it does**:
- Loads the bundled server from `dist/`
- Discovers tools from bundled files
- Validates tool inputs/outputs against schemas
- Handles MCP protocol requests (JSON-RPC over HTTP)
- Manages tool execution with timeouts and error handling
- Provides context injection for authenticated requests

**When to use**:
- Production deployment on dwizi gateway
- Running bundled servers in isolated environments
- Executing tools with sandboxed permissions

**Key characteristics**:
- **Isolated**: Each tool can run in its own execution context
- **Validated**: Input/output schemas are enforced
- **Monitored**: Tool execution is tracked and logged
- **Secure**: Permissions from `mcp.json` are enforced

**Example workflow**:
```bash
# This happens automatically in the dwizi gateway
# Your bundled server is loaded and tools are executed
# based on MCP protocol requests
```

### Comparison Table

| Feature | Dev Mode | Build Mode | Runtime Mode |
|---------|----------|------------|--------------|
| **Purpose** | Local development | Create bundles | Execute in production |
| **Bundling** | No (source files) | Yes (bundled) | Uses bundled output |
| **Hot Reload** | Yes | No | No |
| **Dashboard** | Yes (`/` endpoint) | No | Optional |
| **Source Maps** | Yes | Optional | Optional |
| **Environment** | `.env` files | Build-time env | Runtime env |
| **Tool Discovery** | From source | From bundles | From bundles |
| **Schema Validation** | Yes | Validates schemas | Enforces schemas |
| **When Used** | Development | Pre-deployment | Production |

### Workflow Example

```bash
# 1. Development: Write and test tools
dzx dev
# Edit tools, see changes immediately

# 2. Build: Create production bundle
dzx build --split-tools
# Verify dist/ output

# 3. Deploy: Gateway uses bundled server
# (Automatic in dwizi platform)
```

---

## Project Structure

A typical dzx project looks like this:

```
your-mcp-server/
├── mcp.json              # Manifest (runtime, entrypoint, permissions)
├── tools/                # Tool implementations
│   ├── hello.ts
│   └── weather.ts
├── resources/            # Resource markdown files
│   └── getting-started.md
├── prompts/              # Prompt templates
│   └── summarize.md
├── src/
│   ├── server.ts        # Server entrypoint (uses @dwizi/dzx/runtime)
│   └── context.ts       # Optional: request context factory
├── dist/                # Build output (generated)
└── .env                 # Environment variables (optional)
```

### Key Files

- **`mcp.json`**: Defines your server's metadata, runtime, entrypoint, and permissions
- **`tools/*.ts`**: Tool implementations (default exports)
- **`resources/*.md`**: Static content exposed as MCP resources
- **`prompts/*.md`**: Prompt templates with mustache placeholders
- **`src/server.ts`**: Server entrypoint that bootstraps the runtime
- **`src/context.ts`**: Optional context factory for request-scoped data

---

## Next Steps

- **Learn about tools**: See [Tool Discovery](#) for schema patterns and best practices
- **Explore the CLI**: Check `docs/cli.md` for all commands and flags
- **Understand the manifest**: Read `docs/manifest.md` for `mcp.json` schema details
- **Test your tools**: Use `@dwizi/dzx/testing` for in-process testing (see `docs/testing.md`)
- **Deploy to dwizi**: Build your bundle and import it via the dwizi platform

---

## Common Questions

### Do I need to install dzx globally?

No. Use `npx create-dzx@latest` to scaffold, and `npx dzx` or `pnpm dzx` to run commands. For installed projects, use `pnpm dzx` or add it to your `package.json` scripts.

### Can I use TypeScript?

Yes! dzx fully supports TypeScript. In dev mode, it uses `tsx` for Node.js. For Deno, TypeScript is native.

### How do I add dependencies?

Just use your package manager normally:
```bash
pnpm add zod
# or
npm install zod
# or (for Deno)
# Add to import_map.json or use npm: specifiers
```

### What's the difference between Node and Deno runtime?

The tool code is the same. The difference is:
- **Node**: Uses `node` with `tsx` for TypeScript, standard npm packages
- **Deno**: Uses `deno run`, native TypeScript, Deno permissions model

Choose based on your deployment target and preferences.

### Can I customize the build process?

Yes. Add a `build.command` in `mcp.json` to run custom build steps before bundling. The bundling itself uses esbuild and can be configured via `dzx build` flags.

### How do I handle authentication?

Use `src/context.ts` to create request-scoped context (e.g., from headers). This context is passed as the second argument to all tools.

---

## Getting Help

- **Documentation**: See `docs/` for detailed guides
- **CLI help**: Run `dzx --help` or `dzx <command> --help`
- **Examples**: Check the templates in `packages/dzx/templates/`
- **Issues**: Report bugs or request features in the dwizi repository
