import assert from "node:assert/strict";
import test from "node:test";
import { withTimeout } from "../dist/runtime/index.js";

test("withTimeout rejects after timeout", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("ok"), 50));
  await assert.rejects(() => withTimeout(slow, 10, "slowTool"), /timed out/);
});

test("withTimeout resolves when fast", async () => {
  const fast = Promise.resolve("ok");
  const result = await withTimeout(fast, 10, "fastTool");
  assert.equal(result, "ok");
});
