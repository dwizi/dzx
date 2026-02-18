import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createTestServer } from "../dist/testing/index.js";

const defaultCwd = path.resolve(process.cwd(), "tests/fixtures/app-features");
const enabledCwd = path.resolve(process.cwd(), "tests/fixtures/mcp-optional-methods");

test("optional MCP methods are disabled by default", async () => {
  const client = await createTestServer({ cwd: defaultCwd });

  const initializeResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }),
  );
  assert.equal(initializeResp?.result?.capabilities?.completions, undefined);

  const templatesResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/templates/list",
      params: {},
    }),
  );
  assert.equal(templatesResp?.error?.code, -32601);

  const completionResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "completion/complete",
      params: {},
    }),
  );
  assert.equal(completionResp?.error?.code, -32601);
});

test("optional MCP methods can be enabled from manifest", async () => {
  const client = await createTestServer({ cwd: enabledCwd });

  const initializeResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }),
  );
  assert.deepEqual(initializeResp?.result?.capabilities?.completions, {});

  const templatesResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/templates/list",
      params: {},
    }),
  );
  assert.deepEqual(templatesResp?.result, { resourceTemplates: [] });

  const completionResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "completion/complete",
      params: {
        ref: {
          type: "resource",
          uri: "resource://anything",
        },
        argument: {
          name: "query",
          value: "abc",
        },
      },
    }),
  );
  assert.deepEqual(completionResp?.result, {
    completion: {
      values: [],
      hasMore: false,
    },
  });
});

test("notifications/complete is accepted as a no-op when enabled", async () => {
  const client = await createTestServer({ cwd: enabledCwd });

  const response = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/complete",
      params: {},
    }),
  );
  assert.equal(response, null);
});
