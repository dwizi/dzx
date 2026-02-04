# Runtime

The dzx runtime hosts your MCP server over HTTP + JSON-RPC. It loads your manifest, discovers tools/resources/prompts, and handles MCP requests.

## HTTP endpoints

- `POST /mcp/<name>` -- JSON-RPC endpoint.
- `GET /health` -- simple health check.
- `GET /status` -- counts for tools/resources/prompts.
- `GET /` -- local dev dashboard.

The `<name>` segment comes from `mcp.json` `name`.

## Method compatibility

dzx accepts both slash and dotted method names:
- `tools/list` and `tools.list`
- `resources/list` and `resources.list`
- `prompts/list` and `prompts.list`

## Core MCP methods

- `initialize`
- `notifications/initialized`
- `tools/list`, `tools/call`
- `resources/list`, `resources/read`, `resources/subscribe`, `resources/unsubscribe`
- `prompts/list`, `prompts/get`
- `logging/setLevel`
- `notifications/cancelled`, `notifications/canceled`

## Calling tools

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "user-profile",
    "arguments": { "userId": "123" }
  }
}
```

Response shape:
- `result.content` is always present (stringified output).
- `result.structuredContent` is included when the output is an object or a schema is defined.

Tool handlers must be `async` and should return a value. If you define an output schema, returning `undefined` is treated as an error.

## Resources

`resources/list` returns a `resource://<name>` URI. `resources/read` accepts that URI or the resource file path.

Example request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": { "uri": "resource://getting-started" }
}
```

## Prompts

`prompts/get` reads the Markdown file, strips frontmatter, and returns the body as a prompt message.

Example request:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "prompts/get",
  "params": { "name": "summarize" }
}
```

## Streaming (SSE)

Enable streaming with either:
- `?stream=1`
- `Accept: text/event-stream`

SSE frames are emitted as:

```
event: message
data: {"jsonrpc":"2.0", ...}
```

## Context injection

If `src/context.ts` (or `context.ts`) exists, the runtime loads it and passes the result as the second argument to every tool.

Example:

```ts
import type { IncomingMessage } from "http";

export default function createContext(req: IncomingMessage) {
  return {
    requestId: req.headers["x-request-id"],
    userId: req.headers["x-user-id"],
  };
}
```

Then in tools:

```ts
export default async function myTool(args, context) {
  return { userId: context.userId };
}
```

## Timeouts

Tool execution is bounded by `DZX_TOOL_TIMEOUT_MS` (default: 30000ms). When a tool times out, the runtime returns a tool error.

## Host and port

- Port defaults to `3333` (or `PORT` if set).
- Dev mode binds to `127.0.0.1` by default.
- Set `DZX_HOST` to override the bind address.

In dev, if TCP listeners are blocked, the runtime falls back to a Unix socket (`DZX_SOCKET` or `/tmp/dzx-<name>.sock`).
