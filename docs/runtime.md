# Runtime

The dzx runtime hosts an MCP server locally over HTTP + JSON-RPC.

## Endpoints
- `POST /mcp/<name>` — JSON-RPC endpoint
- `GET /health` — simple health probe
- `GET /status` — summary with tool/resource/prompt counts
- `GET /` — local dev dashboard

## Streaming (SSE)
Enable SSE with either:
- `?stream=1`
- `Accept: text/event-stream`

SSE frames are:
```
event: message
data: {"jsonrpc":"2.0", ...}
```

## Method compatibility
dzx accepts both slash and dotted methods:
- `tools/list` and `tools.list`
- `resources/list` and `resources.list`
- `prompts/list` and `prompts.list`

## Core methods
- `initialize`
- `tools/list`, `tools/call`
- `resources/list`, `resources/read`, `resources/subscribe`, `resources/unsubscribe`
- `prompts/list`, `prompts/get`
- `notifications/initialized`
- `logging/setLevel`
- `notifications/cancelled`, `notifications/canceled`

## Context
If `src/context.ts` exists, its default export is called for each request and
passed as the second argument to tools.
