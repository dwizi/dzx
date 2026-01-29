import {
  createServerFromManifest,
  type RuntimeOptions,
  type RuntimeServer,
} from "../runtime/index.js";

export type TestClient = {
  server: RuntimeServer;
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) => Promise<unknown>;
  readResource: (uri: string, context?: Record<string, unknown>) => Promise<unknown>;
  getPrompt: (
    name: string,
    args?: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) => Promise<unknown>;
};

type JsonRpcError = { code?: number; message?: string };
type JsonRpcResponse = { error?: JsonRpcError; result?: unknown };

/**
 * Ensure a value is a record-like object.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/**
 * Coerce a raw response into a JSON-RPC response shape.
 */
function getRpcResponse(value: unknown): JsonRpcResponse | null {
  const record = asRecord(value);
  if (!record) return null;
  return record as JsonRpcResponse;
}

/**
 * Create an in-process runtime server for tests without HTTP.
 */
export async function createTestServer(options: RuntimeOptions = {}): Promise<TestClient> {
  // Ensure we don't auto-start the HTTP server
  const server = createServerFromManifest({ ...options, autoStart: false });

  // Initialize discovery and context
  await server.init();

  return {
    server,
    async callTool(
      name: string,
      args: Record<string, unknown> = {},
      context: Record<string, unknown> = {},
    ) {
      const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      };

      const rawResponse = await server.processRequest(JSON.stringify(request), context);
      const response = getRpcResponse(rawResponse);

      // Handle JSON-RPC errors or protocol errors
      if (!response) {
        throw new Error("No response from server");
      }

      if (response.error) {
        throw new Error(`RPC Error ${response.error.code}: ${response.error.message}`);
      }

      const result = response.result as {
        isError?: boolean;
        structuredContent?: unknown;
        content?: Array<{ text?: string }>;
      };
      if (result?.isError) {
        const text = result.content?.[0]?.text ?? "Unknown tool error";
        throw new Error(text);
      }

      if (result?.structuredContent) {
        return result.structuredContent;
      }

      try {
        return JSON.parse(result.content?.[0]?.text ?? "");
      } catch {
        return result.content?.[0]?.text ?? "";
      }
    },

    async readResource(uri: string, context: Record<string, unknown> = {}) {
      const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri },
      };
      const rawResponse = await server.processRequest(JSON.stringify(request), context);
      const response = getRpcResponse(rawResponse);
      if (response?.error) {
        throw new Error(response.error.message ?? "Request failed");
      }
      const result = response?.result;
      const resultObject =
        result && typeof result === "object" ? (result as { contents?: unknown[] }) : undefined;
      return resultObject?.contents?.[0];
    },

    async getPrompt(
      name: string,
      args: Record<string, unknown> = {},
      context: Record<string, unknown> = {},
    ) {
      const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name, arguments: args },
      };
      const rawResponse = await server.processRequest(JSON.stringify(request), context);
      const response = getRpcResponse(rawResponse);
      if (response?.error) {
        throw new Error(response.error.message ?? "Request failed");
      }
      const result = response?.result;
      const resultObject =
        result && typeof result === "object" ? (result as { prompt?: unknown }) : undefined;
      return resultObject?.prompt;
    },
  };
}
