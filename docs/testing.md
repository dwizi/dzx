# Testing SDK

Use `@dwizi/dzx/testing` to call tools in-process without spinning up HTTP.

```ts
import { createTestServer } from "@dwizi/dzx/testing";
import assert from "node:assert";

const client = await createTestServer({ cwd: process.cwd() });
const result = await client.callTool("my-tool", { input: 1 }, { user: "test" });

assert.equal(result.ok, true);
```

Helpers:
- `callTool(name, args, context)`
- `readResource(uri, context)`
- `getPrompt(name, args, context)`
