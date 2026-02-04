# Testing SDK

Use `@dwizi/dzx/testing` to call tools in-process without spinning up HTTP. This is ideal for unit tests and integration tests.

## Basic usage

```ts
import { createTestServer } from "@dwizi/dzx/testing";
import assert from "node:assert";

const client = await createTestServer({ cwd: process.cwd() });

const result = await client.callTool("my-tool", { input: 1 }, { user: "test" });
assert.equal(result.ok, true);
```

## API

### `createTestServer(options)`

Creates a runtime server in-process and returns a test client. `options` map to runtime options:
- `cwd` (string) -- repo root to load `mcp.json` from.
- `config` (string) -- manifest path (default: `mcp.json`).
- `port` (number) -- ignored for tests, but accepted for parity.

### `callTool(name, args?, context?)`

Calls a tool by name. Throws if:
- The tool is missing.
- Input validation fails.
- The tool returns an MCP error.

Returns structured output when available, otherwise parses JSON text from the tool response.

### `readResource(uri, context?)`

Reads a resource and returns the first content item. Accepts `resource://<name>` or a resource file path.

### `getPrompt(name, args?, context?)`

Returns the prompt object for a named prompt, including the prompt messages.

## Example: testing a tool with context

```ts
import { createTestServer } from "@dwizi/dzx/testing";
import { test } from "node:test";
import assert from "node:assert";

test("greets with user name", async () => {
  const client = await createTestServer({ cwd: process.cwd() });
  const result = await client.callTool("greet", { name: "Ada" }, { userId: "u_123" });
  assert.equal(result.message, "Hello Ada");
});
```

## Example: testing a resource

```ts
import { createTestServer } from "@dwizi/dzx/testing";
import assert from "node:assert";

const client = await createTestServer({ cwd: process.cwd() });
const resource = await client.readResource("resource://getting-started");
assert.equal(resource.mimeType, "text/markdown");
```
