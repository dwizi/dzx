import assert from "node:assert";
import path from "node:path";
import { test } from "node:test";
import { createTestServer } from "../dist/testing/index.js";

const cwd = path.resolve(process.cwd(), "tests/fixtures/app-features");

test("Feature: Context Injection", async (_t) => {
  const client = await createTestServer({ cwd });

  // Mock context to simulate what src/context.ts would produce
  const mockContext = { user: "Carlos", role: "admin" };

  const result = await client.callTool("smart-hello", { name: "World" }, mockContext);

  assert.strictEqual(result.message, "Hello World");
  assert.strictEqual(result.currentUser, "Carlos");
  assert.strictEqual(result.authorized, true);
});

test("Feature: Generic Schema Validation (Zod-like)", async (t) => {
  const client = await createTestServer({ cwd });
  const mockContext = { user: "Carlos", role: "admin" };

  await t.test("Valid input passed through .parse()", async () => {
    const result = await client.callTool("smart-hello", { name: "Alice" }, mockContext);
    assert.strictEqual(result.message, "Hello Alice");
  });

  await t.test("Invalid input caught by .parse()", async () => {
    try {
      await client.callTool("smart-hello", { name: 123 }, mockContext);
      assert.fail("Should have thrown validation error");
    } catch (err) {
      assert.match(err.message, /input validation failed/);
    }
  });
});

test("Initialize includes tools", async () => {
  const client = await createTestServer({ cwd });
  const resp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
  );
  const tools = resp?.result?.tools ?? [];
  const resources = resp?.result?.resources ?? [];
  const prompts = resp?.result?.prompts ?? [];
  assert.ok(Array.isArray(tools));
  assert.ok(Array.isArray(resources));
  assert.ok(Array.isArray(prompts));
  assert.ok(tools.length > 0, "tools should be included on initialize");
});

test("Initialize defaults to latest protocol version", async () => {
  const client = await createTestServer({ cwd });
  const resp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }),
  );
  assert.strictEqual(resp?.result?.protocolVersion, "2025-11-25");
});

test("Compatibility: dotted method names", async () => {
  const client = await createTestServer({ cwd });
  const resp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools.list",
      params: {},
    }),
  );
  assert.ok(resp?.result?.tools, "tools.list should be accepted");
});

test("Compatibility: resources subscribe no-op", async () => {
  const client = await createTestServer({ cwd });
  const resp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources.subscribe",
      params: {},
    }),
  );
  assert.deepStrictEqual(resp?.result, {});
});
test("Feature: Schema Exposure (toJSONSchema)", async (_t) => {
  const client = await createTestServer({ cwd });

  const listResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  );

  const tool = listResp.result.tools.find((t) => t.name === "smart-hello");

  assert.deepStrictEqual(tool.inputSchema, {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  });

  // Output schema also transformed
  assert.deepStrictEqual(tool.outputSchema, {
    type: "object",
    properties: {
      message: { type: "string" },
      currentUser: { type: "string" },
      authorized: { type: "boolean" },
    },
  });
});

test("Feature: Output requires structured content when schema is defined", async () => {
  const client = await createTestServer({ cwd });
  await assert.rejects(() => client.callTool("bad-output"), /structured output required/i);
});
