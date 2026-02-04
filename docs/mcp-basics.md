# MCP Basics

MCP (Model Context Protocol) is a JSON-RPC based protocol for exposing tools, resources, and prompts to clients. A client does not need to know your internal code structure; it only needs MCP methods and structured metadata.

Think of MCP as a standard contract between:
- A server that provides tools, resources, and prompts.
- A client that discovers and calls those capabilities.

## Core ideas

### Tools

Tools are functions a client can call with structured arguments. They have:
- A name.
- A description.
- An input schema (arguments).
- An output schema (structured results).

### Resources

Resources are static content (typically Markdown) that clients can read. They are identified by `resource://<name>` URIs and include a media type.

### Prompts

Prompts are templated Markdown files with optional input definitions. Clients request a prompt and fill in inputs.

## Typical flow

1. Client calls `initialize` to negotiate protocol and discover capabilities.
2. Client calls `tools/list`, `resources/list`, `prompts/list`.
3. Client calls tools with `tools/call`.
4. Client reads resources with `resources/read`.
5. Client fetches prompts with `prompts/get`.

## Example: list tools

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

Response contains an array of tools with names and schemas.

## Example: call a tool

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "user-profile",
    "arguments": { "userId": "123" }
  }
}
```

Responses return a `result` payload with both a human-readable `content` and a `structuredContent` value when possible.

## Why dzx

dzx implements MCP end-to-end. You define tools and content in files, and dzx handles:
- Discovery and metadata.
- Schema inference and validation.
- HTTP + JSON-RPC serving.
- Build output and import manifests.
