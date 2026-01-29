import assert from "node:assert/strict";
import test from "node:test";
import { parseTypeString } from "../dist/core/discovery.js";

test("parseTypeString parses object shape with optional", async () => {
  const schema = parseTypeString("{ slug: string, count?: number }");
  assert.deepEqual(schema, {
    type: "object",
    properties: {
      slug: { type: "string" },
      count: { type: "number" },
    },
    required: ["slug"],
    additionalProperties: false,
  });
});

test("parseTypeString parses arrays", async () => {
  const schema = parseTypeString("Array<string>");
  assert.deepEqual(schema, { type: "array", items: { type: "string" } });
});

test("parseTypeString parses unions", async () => {
  const schema = parseTypeString("string | number");
  assert.deepEqual(schema, {
    anyOf: [{ type: "string" }, { type: "number" }],
  });
});

test("parseTypeString parses tuples", async () => {
  const schema = parseTypeString("[string, number]");
  assert.deepEqual(schema, {
    type: "array",
    items: [{ type: "string" }, { type: "number" }],
    minItems: 2,
    maxItems: 2,
  });
});

test("parseTypeString parses literals", async () => {
  assert.deepEqual(parseTypeString('"ok"'), { const: "ok" });
  assert.deepEqual(parseTypeString("42"), { const: 42 });
  assert.deepEqual(parseTypeString("true"), { const: true });
});

test("parseTypeString parses parens union arrays", async () => {
  const schema = parseTypeString("(string | number)[]");
  assert.deepEqual(schema, {
    type: "array",
    items: { anyOf: [{ type: "string" }, { type: "number" }] },
  });
});

test("parseTypeString parses Tuple<>", async () => {
  const schema = parseTypeString("Tuple<string, number, boolean>");
  assert.deepEqual(schema, {
    type: "array",
    items: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
    minItems: 3,
    maxItems: 3,
  });
});

test("parseTypeString parses intersections", async () => {
  const schema = parseTypeString("{ a: string } & { b: number }");
  assert.deepEqual(schema, {
    allOf: [
      {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { b: { type: "number" } },
        required: ["b"],
        additionalProperties: false,
      },
    ],
  });
});

test("parseTypeString parses Set and Map", async () => {
  assert.deepEqual(parseTypeString("Set<string>"), {
    type: "array",
    items: { type: "string" },
    uniqueItems: true,
  });
  assert.deepEqual(parseTypeString("Map<string, number>"), {
    type: "object",
    additionalProperties: { type: "number" },
  });
});

test("parseTypeString parses Date, bigint, unknown", async () => {
  assert.deepEqual(parseTypeString("Date"), { type: "string", format: "date-time" });
  assert.deepEqual(parseTypeString("bigint"), { type: "integer" });
  assert.deepEqual(parseTypeString("unknown"), {});
});
