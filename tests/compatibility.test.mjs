import assert from "node:assert";
import { test } from "node:test";
import { formatSseMessage } from "../dist/runtime/index.js";

test("Compatibility: SSE message format", () => {
  const payload = { jsonrpc: "2.0", id: 1, result: { ok: true } };
  const message = formatSseMessage(payload);
  assert.match(message, /^event: message\ndata: /);
  assert.ok(message.includes(`data: ${JSON.stringify(payload)}`));
  assert.ok(message.endsWith("\n\n"));
});
