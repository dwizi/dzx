import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../dist/runtime/index.js";

test("validateSchema rejects invalid output", async () => {
  const schema = {
    type: "object",
    properties: { slug: { type: "string" } },
    required: ["slug"],
    additionalProperties: false,
  };
  const result = validateSchema(schema, { ok: true });
  assert.equal(result.ok, false);
});

test("validateSchema accepts valid output", async () => {
  const schema = {
    type: "object",
    properties: { slug: { type: "string" } },
    required: ["slug"],
    additionalProperties: false,
  };
  const result = validateSchema(schema, { slug: "ok" });
  assert.equal(result.ok, true);
});
