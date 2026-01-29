import assert from "node:assert";
import path from "node:path";
import { test } from "node:test";
import { createTestServer } from "../dist/testing/index.js";

const cwd = path.resolve(process.cwd(), "tests/fixtures/inference");

test("Feature: JSDoc Schema Inference (Input & Output)", async (_t) => {
  const client = await createTestServer({ cwd });

  const listResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  );

  const tool = listResp.result.tools.find((t) => t.name === "inferred");
  assert.ok(tool, "Tool 'inferred' should be discovered");

  // Check inferred input schema
  assert.deepStrictEqual(tool.inputSchema, {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name"],
    additionalProperties: false,
  });

  // Check inferred output schema
  assert.deepStrictEqual(tool.outputSchema, {
    type: "object",
    properties: {
      msg: { type: "string" },
    },
    required: ["msg"],
    additionalProperties: false,
  });

  const result = await client.callTool("inferred", { name: "Bob", age: 30 });
  assert.strictEqual(result.msg, "Hello Bob, age 30");
});

test("Feature: JSDoc Output String", async () => {
  const client = await createTestServer({ cwd });
  const result = await client.callTool("return-string");
  assert.strictEqual(result, "ok");
});

test("Feature: JSDoc Plain Params", async () => {
  const client = await createTestServer({ cwd });
  const listResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  );
  const tool = listResp.result.tools.find((t) => t.name === "jsdoc-plain-params");
  assert.ok(tool, "Tool 'jsdoc-plain-params' should be discovered");
  assert.deepStrictEqual(tool.inputSchema, {
    type: "object",
    properties: {
      name: { type: "string" },
      count: { type: "number" },
    },
    required: ["name"],
    additionalProperties: false,
  });
  assert.deepStrictEqual(tool.outputSchema, { type: "string" });
  const result = await client.callTool("jsdoc-plain-params", { name: "dwizi", count: 2 });
  assert.strictEqual(result, "hi dwizi (2)");
});

test("Feature: Param Unboxing Inference", async () => {
  const client = await createTestServer({ cwd });
  const listResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  );
  const tools = listResp.result.tools;
  const tool = tools.find((t) => t.name === "input-unboxed");
  assert.ok(tool, "Tool 'input-unboxed' should be discovered");
  assert.deepStrictEqual(tool.inputSchema, {
    type: "object",
    properties: {
      name: {},
      count: {},
    },
    required: ["name"],
    additionalProperties: true,
  });
});

test("Feature: JSDoc Output Edge Cases", async () => {
  const client = await createTestServer({ cwd });
  const listResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  );
  const tools = listResp.result.tools;

  const expectSchema = (name, schema) => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `Tool '${name}' should be discovered`);
    assert.deepStrictEqual(tool.outputSchema, schema);
  };

  expectSchema("return-object", {
    type: "object",
    properties: {
      slug: { type: "string" },
      count: { type: "number" },
    },
    required: ["slug"],
    additionalProperties: false,
  });

  expectSchema("return-promise-object", {
    type: "object",
    properties: {
      id: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["id"],
    additionalProperties: false,
  });

  expectSchema("return-string", { type: "string" });

  expectSchema("return-string-array", {
    type: "array",
    items: { type: "string" },
  });

  expectSchema("return-array-of-objects", {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        score: { type: "number" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  });

  expectSchema("return-union", {
    anyOf: [{ type: "string" }, { type: "number" }],
  });

  expectSchema("return-record", {
    type: "object",
    additionalProperties: { type: "number" },
  });

  expectSchema("return-nested", {
    type: "object",
    properties: {
      meta: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["meta"],
    additionalProperties: false,
  });

  expectSchema("return-tuple", {
    type: "array",
    items: [{ type: "string" }, { type: "number" }],
    minItems: 2,
    maxItems: 2,
  });

  expectSchema("return-literal-string", { const: "ok" });
  expectSchema("return-literal-number", { const: 42 });

  expectSchema("return-array-union", {
    type: "array",
    items: {
      anyOf: [{ type: "string" }, { type: "number" }],
    },
  });

  expectSchema("return-record-array", {
    type: "object",
    additionalProperties: { type: "array", items: { type: "string" } },
  });

  expectSchema("return-nested-union", {
    type: "object",
    properties: {
      status: { anyOf: [{ const: "ok" }, { const: "error" }] },
      code: { anyOf: [{ type: "number" }, { type: "null" }] },
    },
    required: ["status"],
    additionalProperties: false,
  });

  expectSchema("return-tuple-objects", {
    type: "array",
    items: [
      {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { id: { type: "string" }, score: { type: "number" } },
        required: ["id"],
        additionalProperties: false,
      },
    ],
    minItems: 2,
    maxItems: 2,
  });

  expectSchema("return-parens-union-array", {
    type: "array",
    items: { anyOf: [{ type: "string" }, { type: "number" }] },
  });

  expectSchema("return-tuple-generic", {
    type: "array",
    items: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
    minItems: 3,
    maxItems: 3,
  });

  expectSchema("return-tuple-props", {
    type: "object",
    properties: {
      dims: {
        type: "array",
        items: [{ type: "number" }, { type: "number" }],
        minItems: 2,
        maxItems: 2,
      },
      flags: {
        type: "array",
        items: [{ const: true }, { const: false }],
        minItems: 2,
        maxItems: 2,
      },
    },
    required: ["dims"],
    additionalProperties: false,
  });

  expectSchema("return-array-of-records", {
    type: "array",
    items: {
      type: "object",
      additionalProperties: { type: "number" },
    },
  });

  expectSchema("return-record-nested-union", {
    type: "object",
    additionalProperties: {
      type: "object",
      properties: {
        score: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
      required: ["score"],
      additionalProperties: false,
    },
  });

  expectSchema("return-mixed-literals", {
    anyOf: [{ const: "ok" }, { const: 1 }, { const: true }],
  });

  expectSchema("return-intersection-object", {
    type: "object",
    properties: {
      meta: {
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
      },
    },
    required: ["meta"],
    additionalProperties: false,
  });

  expectSchema("return-readonly-array", {
    type: "array",
    items: { type: "string" },
  });

  expectSchema("return-set", {
    type: "array",
    items: { type: "number" },
    uniqueItems: true,
  });

  expectSchema("return-map", {
    type: "object",
    additionalProperties: { type: "number" },
  });

  expectSchema("return-date", { type: "string", format: "date-time" });
  expectSchema("return-bigint", { type: "integer" });
  expectSchema("return-unknown", {});

  expectSchema("return-array-record-nested-union", {
    type: "array",
    items: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          score: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
        required: ["score"],
        additionalProperties: false,
      },
    },
  });

  expectSchema("return-nested-parens-array", {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "array",
          items: { anyOf: [{ type: "string" }, { type: "number" }] },
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  });
});

test("Feature: JSDoc Input Edge Cases", async () => {
  const client = await createTestServer({ cwd });
  const listResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  );
  const tools = listResp.result.tools;
  const tool = tools.find((t) => t.name === "input-edge");
  assert.ok(tool, "Tool 'input-edge' should be discovered");

  assert.deepStrictEqual(tool.inputSchema, {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
      count: { anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }] },
      modes: { type: "array", items: { anyOf: [{ const: "a" }, { const: "b" }] } },
    },
    required: ["tags"],
    additionalProperties: false,
  });
});

test("Feature: JSDoc Input Parens Unions", async () => {
  const client = await createTestServer({ cwd });
  const listResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  );
  const tools = listResp.result.tools;
  const tool = tools.find((t) => t.name === "input-parens-union");
  assert.ok(tool, "Tool 'input-parens-union' should be discovered");

  assert.deepStrictEqual(tool.inputSchema, {
    type: "object",
    properties: {
      values: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
      pair: {
        type: "array",
        items: [{ type: "string" }, { type: "number" }],
        minItems: 2,
        maxItems: 2,
      },
    },
    required: ["values"],
    additionalProperties: false,
  });
});

test("Feature: JSDoc Input Set/Map", async () => {
  const client = await createTestServer({ cwd });
  const listResp = await client.server.processRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  );
  const tools = listResp.result.tools;
  const tool = tools.find((t) => t.name === "input-set-map");
  assert.ok(tool, "Tool 'input-set-map' should be discovered");

  assert.deepStrictEqual(tool.inputSchema, {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" }, uniqueItems: true },
      weights: { type: "object", additionalProperties: { type: "number" } },
    },
    required: ["tags"],
    additionalProperties: false,
  });
});
