import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv, { type Options as AjvOptions } from "ajv";
import { type ComponentChildren, h } from "preact";
import { renderToString } from "preact-render-to-string";
import { colorize, symbols } from "../cli/format.js";
import {
  type DiscoveredPrompt,
  type DiscoveredResource,
  type DiscoveredTool,
  discoverPrompts,
  discoverResources,
  discoverTools,
} from "../core/discovery.js";
import { loadEnvFiles } from "../core/env.js";
import { parseFrontmatter } from "../core/frontmatter.js";
import { loadManifest, normalizeManifest } from "../core/manifest.js";
import { getDzxVersion } from "../shared/version.js";

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

type AjvInstance = import("ajv").default;
type AjvConstructor = new (options?: AjvOptions) => AjvInstance;
const AjvCtor =
  (Ajv as unknown as { default?: AjvConstructor }).default ?? (Ajv as unknown as AjvConstructor);
const ajv = new AjvCtor({ allErrors: true, strict: false });
const schemaCache = new Map<string, ReturnType<typeof ajv.compile>>();

type JSONRPCRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
};

type JSONRPCResponse = {
  jsonrpc: string;
  id: JSONRPCRequest["id"];
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type ToolMetrics = {
  calls: number;
  totalMs: number;
  lastMs?: number;
  avgMs?: number;
  p95Ms?: number;
  lastCallAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  samples: number[];
};

type ErrorEntry = {
  message: string;
  tool?: string;
  at: string;
};

type DevMetrics = {
  startedAt: number;
  requests: { total: number; byEndpoint: Map<string, number> };
  tools: Map<string, ToolMetrics>;
  lastError: ErrorEntry | null;
  recentErrors: ErrorEntry[];
};

const MAX_LATENCY_SAMPLES = 50;
const MAX_RECENT_ERRORS = 5;

export type RuntimeOptions = {
  cwd?: string;
  config?: string;
  port?: number;
  autoStart?: boolean;
};

export type RuntimeServer = {
  manifest: ReturnType<typeof normalizeManifest>;
  init: () => Promise<void>;
  start: () => Promise<void>;
  processRequest: (raw: string, context?: unknown) => Promise<unknown | null>;
};

type JsonSchemaProvider = {
  toJSONSchema: () => unknown;
};

type SchemaParser = {
  parse: (data: unknown) => unknown;
};

type SchemaValidator = {
  validate: (data: unknown) => { error?: { message?: string } } | unknown;
};

type ZodIssueLike = {
  path?: Array<string | number>;
  message?: string;
};

type ZodErrorLike = {
  issues?: ZodIssueLike[];
  message?: string;
};

/**
 * Check whether a value exposes toJSONSchema.
 */
function hasToJSONSchema(schema: unknown): schema is JsonSchemaProvider {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "toJSONSchema" in schema &&
    typeof (schema as JsonSchemaProvider).toJSONSchema === "function"
  );
}

/**
 * Check whether a value exposes parse().
 */
function hasParse(schema: unknown): schema is SchemaParser {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "parse" in schema &&
    typeof (schema as SchemaParser).parse === "function"
  );
}

/**
 * Check whether a value exposes validate().
 */
function hasValidate(schema: unknown): schema is SchemaValidator {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "validate" in schema &&
    typeof (schema as SchemaValidator).validate === "function"
  );
}

/**
 * Create a metrics tracker for local dev.
 */
function createMetrics(): DevMetrics {
  return {
    startedAt: Date.now(),
    requests: { total: 0, byEndpoint: new Map() },
    tools: new Map(),
    lastError: null,
    recentErrors: [],
  };
}

/**
 * Ensure tool metrics exist for a given tool name.
 */
function ensureToolMetrics(metrics: DevMetrics, toolName: string): ToolMetrics {
  const existing = metrics.tools.get(toolName);
  if (existing) return existing;
  const created: ToolMetrics = { calls: 0, totalMs: 0, samples: [] };
  metrics.tools.set(toolName, created);
  return created;
}

/**
 * Record an endpoint hit in the metrics tracker.
 */
function recordEndpoint(metrics: DevMetrics, pathname: string): void {
  metrics.requests.total += 1;
  metrics.requests.byEndpoint.set(pathname, (metrics.requests.byEndpoint.get(pathname) ?? 0) + 1);
}

/**
 * Record a tool call duration and optional error.
 */
function recordToolCall(
  metrics: DevMetrics,
  toolName: string,
  durationMs: number,
  errorMessage?: string,
): void {
  const toolMetrics = ensureToolMetrics(metrics, toolName);
  toolMetrics.calls += 1;
  toolMetrics.totalMs += durationMs;
  toolMetrics.lastMs = durationMs;
  toolMetrics.lastCallAt = new Date().toISOString();
  toolMetrics.samples.push(durationMs);
  if (toolMetrics.samples.length > MAX_LATENCY_SAMPLES) {
    toolMetrics.samples.shift();
  }
  toolMetrics.avgMs = Math.round(toolMetrics.totalMs / toolMetrics.calls);
  toolMetrics.p95Ms = percentile(toolMetrics.samples, 0.95);
  if (errorMessage) {
    recordError(metrics, errorMessage, toolName);
    toolMetrics.lastError = errorMessage;
    toolMetrics.lastErrorAt = new Date().toISOString();
  }
}

/**
 * Record a global error and keep a rolling buffer.
 */
function recordError(metrics: DevMetrics, message: string, tool?: string): void {
  const entry = { message, tool, at: new Date().toISOString() };
  metrics.lastError = entry;
  metrics.recentErrors.unshift(entry);
  if (metrics.recentErrors.length > MAX_RECENT_ERRORS) {
    metrics.recentErrors = metrics.recentErrors.slice(0, MAX_RECENT_ERRORS);
  }
}

/**
 * Compute a percentile value from a list of numbers.
 */
function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

/**
 * Format milliseconds for dashboard display.
 */
function formatDuration(ms?: number): string {
  if (ms === undefined) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * Format uptime as a short human-friendly string.
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format ISO timestamps for dashboard display.
 */
function formatTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-US", { hour12: false });
}

const DASHBOARD_CSS = `
:root {
  --background: #0b0b0c;
  --foreground: #f4f4f5;
  --card: #101114;
  --card-foreground: #f4f4f5;
  --muted: #14161b;
  --muted-foreground: #9fa3af;
  --border: #242833;
  --accent: #1b1f27;
  --ring: #8073f6;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #f43f5e;
}
* { box-sizing: border-box; }
html {
  background: black;
}
body {
  margin: 0;
  color: var(--foreground);
  font-family: "Geist Variable", "Geist", ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: linear-gradient(to bottom, #1E1E1E 0%, #101010 100%);
  background-attachment: fixed;
  min-height: 100vh;
}
header {
  padding: 28px 32px 24px;
  border-bottom: 1px solid var(--border);
}
header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
header p {
  margin: 6px 0 0;
  color: var(--muted-foreground);
  font-size: 14px;
}
main {
  padding: 28px 32px 40px;
  display: grid;
  gap: 20px;
}
section {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 18px 20px;
}
h2 {
  margin: 0 0 14px;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.card {
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
}
.card-label {
  color: var(--muted-foreground);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.card-value {
  margin-top: 6px;
  font-size: 18px;
  font-weight: 600;
}
.mono { font-family: "Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #0f1115;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.grid-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}
.grid-list li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  color: var(--card-foreground);
  font-size: 14px;
}
.grid-list span:last-child {
  color: var(--muted-foreground);
  font-size: 13px;
}
.grid-list .endpoint-meta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
button.copy-btn {
  border: 1px solid var(--border);
  background: #0f1115;
  color: var(--muted-foreground);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}
button.copy-btn:hover {
  color: var(--foreground);
  border-color: var(--ring);
}
code {
  color: var(--foreground);
  background: #0f1115;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th, td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted-foreground);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.row-title { font-weight: 600; }
.row-sub { color: var(--muted-foreground); font-size: 13px; margin-top: 4px; }
.empty { color: var(--muted-foreground); font-size: 14px; }
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #0f1115;
  border: 1px solid var(--border);
  font-size: 12px;
}
.status-ok { color: var(--success); }
.status-warn { color: var(--warning); }
.status-bad { color: var(--danger); }
@media (max-width: 900px) {
  main { padding: 20px; }
  header { padding: 24px 20px; }
  table { display: block; overflow-x: auto; }
}
`;

/**
 * Ensure a value is a record-like object.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/**
 * Load an optional context factory module from the repo.
 */
async function loadContextModule(
  cwd: string,
): Promise<((req: http.IncomingMessage) => Promise<unknown> | unknown) | null> {
  const candidates = [
    path.join(cwd, "src", "context.ts"),
    path.join(cwd, "src", "context.js"),
    path.join(cwd, "context.ts"),
    path.join(cwd, "context.js"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        const fileUrl = pathToFileURL(file).href;
        const mod = await import(fileUrl);
        return mod.default || mod.createContext;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`Failed to load context module from ${file}:`, err);
      }
    }
  }
  return null;
}

/**
 * Detect whether the client requested SSE streaming.
 */
function wantsStream(req: http.IncomingMessage): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  const streamParam = url.searchParams.get("stream");
  if (streamParam === "1" || streamParam === "true") return true;
  const accept = req.headers.accept ?? "";
  return typeof accept === "string" && accept.includes("text/event-stream");
}

/**
 * Read the full request body as a string.
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Write a JSON response with status code.
 */
function writeJSON(res: http.ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/**
 * MCP-over-SSE uses `event: message` frames with JSON-RPC payloads.
 */
export function formatSseMessage(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Write a single SSE message with JSON-RPC payload.
 */
function writeSSE(res: http.ServerResponse, payload: unknown): void {
  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }
  try {
    res.write(formatSseMessage(payload));
  } finally {
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
  }
}

/**
 * Split a raw request body into individual JSON-RPC payloads.
 */
function splitJsonRpcRequests(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const segments: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth++;
      continue;
    }
    if ((char === "}" || char === "]") && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        segments.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }
  if (segments.length === 0 && trimmed) {
    segments.push(trimmed);
  }
  return segments;
}

/**
 * Create a JSON-RPC error response.
 */
function invalidRequest(id: JSONRPCRequest["id"], message: string, code = -32600): JSONRPCResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Normalize tool metadata for JSON-RPC responses.
 */
function normalizeToolList(tools: DiscoveredTool[]): Array<{
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}> {
  return tools.map((tool) => {
    const inputSchema = hasToJSONSchema(tool.inputSchema)
      ? tool.inputSchema.toJSONSchema()
      : (tool.inputSchema ?? { type: "object", properties: {} });

    const outputSchema = hasToJSONSchema(tool.outputSchema)
      ? tool.outputSchema.toJSONSchema()
      : (tool.outputSchema ?? { type: "object", properties: {} });

    const normalized = {
      name: tool.name,
      title: tool.name,
      description: tool.description ?? "",
      inputSchema,
    };

    if (tool.outputSchemaSource && tool.outputSchemaSource !== "default") {
      return { ...normalized, outputSchema };
    }

    return normalized;
  });
}

/**
 * Build a resource URI from a name.
 */
function resourceUri(name: string): string {
  return `resource://${name}`;
}

/**
 * Format a tool file location label.
 */
function formatToolLocation(tool: DiscoveredTool): string {
  if (tool.location) {
    return `${tool.file}:${tool.location.line}:${tool.location.column}`;
  }
  return tool.file;
}

/**
 * Normalize client method names to slash form.
 */
function normalizeMethod(method?: string): string | undefined {
  if (!method) return method;
  // Accept dotted method names for client compatibility (tools.list -> tools/list).
  if (method.includes(".") && !method.includes("/")) {
    return method.split(".").join("/");
  }
  return method;
}

/**
 * Convert prompt inputs into MCP arguments metadata.
 */
function promptArguments(
  inputs?: Array<{ name: string; type: string; description?: string }>,
): Array<{ name: string; description?: string; required: boolean }> {
  if (!inputs || inputs.length === 0) return [];
  return inputs.map((input) => ({
    name: input.name,
    description: input.description,
    required: false,
  }));
}

/**
 * Dynamically import a tool module by file path.
 */
async function loadToolModule(toolFile: string): Promise<Record<string, unknown>> {
  const fileUrl = pathToFileURL(toolFile);
  if (process.env.DZX_DEV === "1") {
    try {
      const stat = fs.statSync(toolFile);
      fileUrl.searchParams.set("t", String(stat.mtimeMs));
    } catch {
      // ignore cache-busting if stat fails
    }
  }
  const mod = await import(fileUrl.href);
  return mod as Record<string, unknown>;
}

/**
 * Build a stable cache key for a schema.
 */
function schemaKey(schema: unknown): string {
  try {
    return JSON.stringify(schema);
  } catch {
    return String(schema);
  }
}

/**
 * Validate payloads against schema objects or JSON Schema.
 */
export function validateSchema(schema: unknown, payload: unknown): { ok: boolean; error?: string } {
  if (!schema || typeof schema !== "object") return { ok: true };

  // 1. Zod-like (.parse)
  if (hasParse(schema)) {
    try {
      schema.parse(payload);
      return { ok: true };
    } catch (err: unknown) {
      const errorLike = err as ZodErrorLike;
      const issues = Array.isArray(errorLike?.issues) ? errorLike.issues : [];
      const msg =
        issues.length > 0
          ? issues
              .map((issue) => {
                const pathLabel = (issue.path ?? []).join(".");
                return `${pathLabel}: ${issue.message ?? "invalid"}`;
              })
              .join("; ")
          : err instanceof Error
            ? err.message
            : String(err);
      return { ok: false, error: msg };
    }
  }

  // 2. Joi/Yup-like (.validate)
  if (hasValidate(schema)) {
    try {
      // Joi returns { error, value }
      const result = schema.validate(payload);
      const resultObject = typeof result === "object" && result !== null ? result : null;
      const errorValue =
        resultObject && "error" in resultObject
          ? (resultObject as { error?: { message?: string } }).error
          : undefined;
      if (errorValue) {
        return { ok: false, error: errorValue.message ?? "validation failed" };
      }
      // Yup throws
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 3. JSON Schema (Ajv)
  // Ensure it looks like a JSON schema (has type or properties etc)
  // or default to Ajv for plain objects
  const key = schemaKey(schema);
  let validator = schemaCache.get(key);
  if (!validator) {
    try {
      validator = ajv.compile(schema as object);
      schemaCache.set(key, validator);
    } catch (err: unknown) {
      // invalid schema compilation
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Invalid schema definition: ${message}` };
    }
  }
  const ok = validator(payload);
  if (ok) return { ok: true };
  return { ok: false, error: ajv.errorsText(validator.errors, { separator: "; " }) };
}

/**
 * Wrap a promise with a timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Render the local dev dashboard HTML page.
 */
function renderDashboard(options: {
  name: string;
  version: string;
  port: number;
  tools: DiscoveredTool[];
  resources: DiscoveredResource[];
  prompts: DiscoveredPrompt[];
  metrics: DevMetrics;
}): string {
  const { name, version, port, tools, resources, prompts, metrics } = options;
  const uptime = formatUptime(Date.now() - metrics.startedAt);
  const endpointEntries = Array.from(metrics.requests.byEndpoint.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const toolRows = tools.map((tool) => {
    const stats = metrics.tools.get(tool.name);
    return {
      name: tool.name,
      description: tool.description ?? "No description",
      calls: stats?.calls ?? 0,
      lastMs: stats?.lastMs,
      avgMs: stats?.avgMs,
      p95Ms: stats?.p95Ms,
      lastError: stats?.lastError,
      lastCallAt: stats?.lastCallAt,
    };
  });

  const SummaryCard = (props: {
    label: string;
    value: string;
    valueId?: string;
    valueClass?: string;
  }) =>
    h("div", { class: "card" }, [
      h("div", { class: "card-label" }, props.label),
      h(
        "div",
        { class: `card-value mono ${props.valueClass ?? ""}`.trim(), id: props.valueId },
        props.value,
      ),
    ]);

  const Section = (props: { title: string; children?: ComponentChildren }) =>
    h("section", null, [h("h2", null, props.title), props.children]);

  const renderKeyValueList = (
    items: Array<{ label: ComponentChildren; value: ComponentChildren; key?: string }>,
    emptyLabel: string,
    listId?: string,
  ) =>
    h(
      "ul",
      { class: "grid-list", id: listId },
      items.length > 0
        ? items.map((item, index) =>
            h("li", { key: item.key ?? `${index}` }, [h("span", null, item.label), item.value]),
          )
        : [h("li", { key: "empty" }, [h("span", null, emptyLabel), h("span", null, "—")])],
    );

  const app = h(
    "html",
    { lang: "en" },
    h("head", null, [
      h("meta", { charSet: "utf-8" }),
      h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h("title", null, `${name} • dzx`),
      h("style", { dangerouslySetInnerHTML: { __html: DASHBOARD_CSS } }),
    ]),
    h("body", null, [
      h("header", null, [
        h("h1", null, [
          name,
          " ",
          h("span", { class: "mono", style: "color:var(--muted-foreground)" }, `v${version}`),
          " ",
          h("span", { class: "badge" }, "dev"),
        ]),
        h("p", null, `dzx dev dashboard • http://localhost:${port}/mcp/${name}`),
      ]),
      h("main", null, [
        h(Section, {
          title: "Summary",
          children: h("div", { class: "summary" }, [
            h(SummaryCard, { label: "Uptime", value: uptime, valueId: "summary-uptime" }),
            h(SummaryCard, {
              label: "Requests",
              value: String(metrics.requests.total),
              valueId: "summary-requests",
            }),
            h(SummaryCard, {
              label: "Tools",
              value: String(tools.length),
              valueId: "summary-tools",
            }),
            h(SummaryCard, {
              label: "Last Error",
              value: metrics.lastError ? formatTime(metrics.lastError.at) : "—",
              valueId: "summary-last-error",
              valueClass: metrics.lastError ? "status-bad" : "status-ok",
            }),
          ]),
        }),
        h(Section, {
          title: "Tools",
          children:
            toolRows.length === 0
              ? h("div", { class: "empty" }, "No tools discovered")
              : h("table", null, [
                  h("thead", null, [
                    h("tr", null, [
                      h("th", null, "Tool"),
                      h("th", null, "Calls"),
                      h("th", null, "Last"),
                      h("th", null, "Avg"),
                      h("th", null, "P95"),
                      h("th", null, "Last Error"),
                      h("th", null, "Last Call"),
                    ]),
                  ]),
                  h(
                    "tbody",
                    null,
                    toolRows.map((row) =>
                      h("tr", { key: row.name, "data-tool": row.name }, [
                        h("td", null, [
                          h("div", { class: "row-title" }, row.name),
                          h("div", { class: "row-sub" }, row.description),
                        ]),
                        h("td", { class: "mono" }, [
                          h("span", { "data-field": "calls" }, String(row.calls)),
                        ]),
                        h("td", { class: "mono" }, [
                          h("span", { "data-field": "lastMs" }, formatDuration(row.lastMs)),
                        ]),
                        h("td", { class: "mono" }, [
                          h("span", { "data-field": "avgMs" }, formatDuration(row.avgMs)),
                        ]),
                        h("td", { class: "mono" }, [
                          h("span", { "data-field": "p95Ms" }, formatDuration(row.p95Ms)),
                        ]),
                        h("td", { class: "mono" }, [
                          h("span", { "data-field": "lastError" }, row.lastError ?? "—"),
                        ]),
                        h("td", { class: "mono" }, [
                          h("span", { "data-field": "lastCallAt" }, formatTime(row.lastCallAt)),
                        ]),
                      ]),
                    ),
                  ),
                ]),
        }),
        h(Section, {
          title: "Resources",
          children: renderKeyValueList(
            resources.map((resource) => ({
              label: resource.name,
              value: h("span", null, resource.description ?? "No description"),
            })),
            "None",
            "resources-list",
          ),
        }),
        h(Section, {
          title: "Prompts",
          children: renderKeyValueList(
            prompts.map((prompt) => ({
              label: prompt.name,
              value: h("span", null, prompt.description ?? "No description"),
            })),
            "None",
            "prompts-list",
          ),
        }),
        h(Section, {
          title: "Endpoints",
          children: renderKeyValueList(
            endpointEntries.map(([pathName, count]) => {
              const url =
                pathName === `/mcp/${name}`
                  ? `http://localhost:${port}/mcp/${name}`
                  : `http://localhost:${port}${pathName}`;
              return {
                key: pathName,
                label: h("code", null, pathName),
                value: h("span", { class: "endpoint-meta" }, [
                  h("span", { class: "mono", "data-endpoint-count": pathName }, String(count)),
                  h("button", { class: "copy-btn", type: "button", "data-copy": url }, "Copy"),
                ]),
              };
            }),
            "None",
            "endpoints-list",
          ),
        }),
        h(Section, {
          title: "Recent Errors",
          children: renderKeyValueList(
            metrics.recentErrors.map((entry) => ({
              label: `${entry.tool ?? "runtime"} • ${entry.message}`,
              value: h("span", { class: "mono" }, formatTime(entry.at)),
            })),
            "No errors",
            "recent-errors",
          ),
        }),
      ]),
      h("script", {
        dangerouslySetInnerHTML: {
          __html: `
const formatDuration = (ms) => {
  if (ms === null || ms === undefined) return "—";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return Math.round(ms) + "ms";
};
const formatUptime = (ms) => {
  if (ms === null || ms === undefined) return "—";
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return days + "d " + (hours % 24) + "h";
  if (hours > 0) return hours + "h " + (mins % 60) + "m";
  if (mins > 0) return mins + "m " + (seconds % 60) + "s";
  return seconds + "s";
};
const formatTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-US", { hour12: false });
};
const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};
const updateEndpoints = (byEndpoint) => {
  for (const [path, count] of Object.entries(byEndpoint || {})) {
    const el = document.querySelector('[data-endpoint-count="' + path + '"]');
    if (el) el.textContent = String(count);
  }
};
const updateTools = (tools) => {
  (tools || []).forEach((tool) => {
    const row = document.querySelector('tr[data-tool="' + tool.name + '"]');
    if (!row) return;
    const setField = (field, value) => {
      const el = row.querySelector('[data-field="' + field + '"]');
      if (el) el.textContent = value;
    };
    setField('calls', String(tool.calls ?? 0));
    setField('lastMs', formatDuration(tool.lastMs));
    setField('avgMs', formatDuration(tool.avgMs));
    setField('p95Ms', formatDuration(tool.p95Ms));
    setField('lastError', tool.lastError ?? "—");
    setField('lastCallAt', formatTime(tool.lastCallAt));
  });
};
const updateErrors = (errors) => {
  const list = document.getElementById('recent-errors');
  if (!list) return;
  list.innerHTML = '';
  if (!errors || errors.length === 0) {
    list.innerHTML = '<li><span>No errors</span><span>—</span></li>';
    return;
  }
  errors.forEach((entry) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.innerHTML = escapeHtml((entry.tool || 'runtime') + ' • ' + entry.message);
    const value = document.createElement('span');
    value.className = 'mono';
    value.textContent = formatTime(entry.at);
    li.appendChild(label);
    li.appendChild(value);
    list.appendChild(li);
  });
};
const refresh = async () => {
  try {
    const res = await fetch('/status', { cache: 'no-store' });
    if (!res.ok) return;
    const status = await res.json();
    setText('summary-uptime', formatUptime(status.uptimeMs));
    setText('summary-requests', String(status.requests?.total ?? 0));
    setText('summary-tools', String(status.counts?.tools ?? 0));
    const lastError = status.lastError?.at ? formatTime(status.lastError.at) : '—';
    setText('summary-last-error', lastError);
    updateEndpoints(status.requests?.byEndpoint ?? {});
    updateTools(status.tools ?? []);
    updateErrors(status.recentErrors ?? []);
  } catch {}
};
const copyButtons = document.querySelectorAll('button[data-copy]');
copyButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const text = button.getAttribute('data-copy');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = original || 'Copy';
      }, 1200);
    } catch {
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
  });
});
refresh();
setInterval(refresh, 2000);
          `,
        },
      }),
    ]),
  );

  return `<!doctype html>${renderToString(app)}`;
}

/**
 * Pick a color function for an HTTP status code.
 */
function statusColor(status: number): (value: string) => string {
  if (status >= 500) return colorize.red;
  if (status >= 400) return colorize.yellow;
  if (status >= 300) return colorize.cyan;
  return colorize.green;
}

type DevLogLevel = "quiet" | "info" | "verbose";

/**
 * Resolve the current dev log level from env.
 */
function resolveLogLevel(): DevLogLevel {
  const level = process.env.DZX_LOG_LEVEL as DevLogLevel | undefined;
  if (level === "quiet" || level === "verbose" || level === "info") return level;
  return "info";
}

/**
 * Log dev output respecting log level and quiet mode.
 */
function logDev(message: string, level: "info" | "verbose" | "error" = "info"): void {
  if (process.env.DZX_DEV !== "1") return;
  const logLevel = resolveLogLevel();
  if (logLevel === "quiet") return;
  if (level === "verbose" && logLevel !== "verbose") return;
  // eslint-disable-next-line no-console
  console.log(message);
}

/**
 * Create a runtime server from a manifest on disk.
 */
export function createServerFromManifest(options: RuntimeOptions = {}): RuntimeServer {
  const cwd = options.cwd ?? process.cwd();
  const { manifest } = loadManifest(cwd, options.config);
  const normalized = normalizeManifest(manifest);
  let tools: DiscoveredTool[] = [];
  let resources: DiscoveredResource[] = [];
  let prompts: DiscoveredPrompt[] = [];
  const metrics = createMetrics();
  let signalHandlersAttached = false;
  let toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS;
  let contextLoader: ((req: http.IncomingMessage) => Promise<unknown> | unknown) | null = null;

  let initialized = false;

  /**
   * Initialize discovery, context, and env for the runtime.
   */
  const init = async () => {
    if (initialized) return;
    if (process.env.DZX_DEV === "1") {
      const envMode = process.env.DZX_ENV ?? process.env.NODE_ENV ?? "development";
      const fileEnv = loadEnvFiles(cwd, envMode);
      for (const [key, value] of Object.entries(fileEnv)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
    const toolsDir = normalized.toolsDir ?? "tools";
    const resourcesDir = normalized.resourcesDir ?? "resources";
    const promptsDir = normalized.promptsDir ?? "prompts";
    toolTimeoutMs =
      Number(process.env.DZX_TOOL_TIMEOUT_MS ?? DEFAULT_TOOL_TIMEOUT_MS) || DEFAULT_TOOL_TIMEOUT_MS;

    /**
     * Emit a formatted warning during discovery.
     */
    const logWarn = (message: string) => {
      logDev(`${colorize.yellow("warn")} ${colorize.gray(message)}`, "info");
    };
    tools = await discoverTools(cwd, toolsDir, { onWarn: logWarn });
    resources = discoverResources(cwd, resourcesDir);
    prompts = discoverPrompts(cwd, promptsDir);
    contextLoader = await loadContextModule(cwd);
    for (const tool of tools) {
      ensureToolMetrics(metrics, tool.name);
    }

    if (process.env.DZX_DEV === "1") {
      for (const tool of tools) {
        const inputSource = tool.inputSchemaSource;
        const outputSource = tool.outputSchemaSource;
        if (inputSource === "default" || outputSource === "default") {
          logDev(
            `${colorize.yellow("warn")} ${colorize.gray(`schema inferred as default for ${tool.name}`)} ${colorize.dim("add schema or JSDoc for stronger validation")}`,
            "verbose",
          );
        }
      }
    }
    initialized = true;
  };

  const server: RuntimeServer = {
    manifest: normalized,
    init,
    processRequest: handleRequest,
    async start() {
      await init();
      const startedAt = Date.now();
      const port = options.port ?? Number(process.env.PORT || 3333);

      const serverInstance = http.createServer(async (req, res) => {
        const requestStart = Date.now();
        /**
         * Log a request summary when the response finishes.
         */
        const logRequest = () => {
          if (process.env.DZX_DEV !== "1") return;
          const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
          const duration = Date.now() - requestStart;
          const method = (req.method ?? "GET").toUpperCase();
          const status = res.statusCode || 200;
          const colorStatus = statusColor(status);
          logDev(
            `${colorize.gray(method)} ${colorize.cyan(url.pathname + url.search)} ${colorStatus(String(status))} ${colorize.dim(`in ${duration}ms`)}`,
            "info",
          );
        };
        res.once("finish", logRequest);

        let context: unknown = {};
        if (contextLoader) {
          try {
            context = await contextLoader(req);
          } catch (err: unknown) {
            logDev(
              `${colorize.red("error")} ${colorize.gray("context creation failed")} ${colorize.dim(err instanceof Error ? err.message : String(err))}`,
              "error",
            );
            res.statusCode = 500;
            res.end("Internal Server Error");
            return;
          }
        }

        const method = req.method ?? "GET";
        const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
        recordEndpoint(metrics, url.pathname);

        if (method === "GET" && url.pathname === "/") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            renderDashboard({
              name: normalized.name,
              version: normalized.version,
              port,
              tools,
              resources,
              prompts,
              metrics,
            }),
          );
          return;
        }

        if (method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
          writeJSON(res, 200, {
            issuer: `http://${req.headers.host || "localhost"}`,
            authorization_endpoint: null,
            token_endpoint: null,
            revocation_endpoint: null,
            introspection_endpoint: null,
            registration_endpoint: null,
            response_types_supported: [],
            grant_types_supported: [],
            token_endpoint_auth_methods_supported: [],
            code_challenge_methods_supported: [],
            status: "not_implemented",
          });
          return;
        }

        if (method === "GET" && url.pathname === "/health") {
          res.statusCode = 200;
          res.end("ok");
          return;
        }

        if (method === "GET" && url.pathname === "/status") {
          const toolStats = tools.map((tool) => {
            const stats = metrics.tools.get(tool.name);
            return {
              name: tool.name,
              description: tool.description ?? "",
              calls: stats?.calls ?? 0,
              lastMs: stats?.lastMs ?? null,
              avgMs: stats?.avgMs ?? null,
              p95Ms: stats?.p95Ms ?? null,
              lastError: stats?.lastError ?? null,
              lastErrorAt: stats?.lastErrorAt ?? null,
              lastCallAt: stats?.lastCallAt ?? null,
            };
          });
          const status = {
            name: normalized.name,
            version: normalized.version,
            runtime: normalized.runtime,
            uptimeMs: Date.now() - metrics.startedAt,
            counts: {
              tools: tools.length,
              resources: resources.length,
              prompts: prompts.length,
            },
            requests: {
              total: metrics.requests.total,
              byEndpoint: Object.fromEntries(metrics.requests.byEndpoint),
            },
            tools: toolStats,
            lastError: metrics.lastError,
            recentErrors: metrics.recentErrors,
          };
          writeJSON(res, 200, status);
          return;
        }

        if (method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }

        if (!url.pathname.startsWith("/mcp/")) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }

        const slug = url.pathname.replace(/^\/mcp\//, "").replace(/\/$/, "");
        if (!slug || slug !== normalized.name) {
          res.statusCode = 404;
          res.end("mcp server not found");
          return;
        }

        const body = await readBody(req);
        if (!body.trim()) {
          res.statusCode = 400;
          res.end("empty body");
          logDev(`${colorize.red("error")} ${colorize.gray("empty body")}`, "error");
          return;
        }

        const stream = wantsStream(req);
        if (stream) {
          await handleStream(body, res, context);
          res.end();
          return;
        }

        const response = await handleRequest(body, context);
        if (response === null) {
          res.statusCode = 202;
          res.end();
          return;
        }
        writeJSON(res, 200, response);
      });

      const host = process.env.DZX_HOST ?? (process.env.DZX_DEV === "1" ? "127.0.0.1" : "0.0.0.0");
      let listenMode: "tcp" | "socket" | "disabled" = "tcp";
      let listenValue = `${host}:${port}`;

      /**
       * Start listening on a TCP host/port.
       */
      const listenTcp = () =>
        new Promise<void>((resolve, reject) => {
          /**
           * Handle TCP listen errors.
           */
          const onError = (err: NodeJS.ErrnoException) => {
            serverInstance.removeListener("listening", onListening);
            reject(err);
          };
          /**
           * Resolve once the TCP server is listening.
           */
          const onListening = () => {
            serverInstance.removeListener("error", onError);
            resolve();
          };
          serverInstance.once("error", onError);
          serverInstance.once("listening", onListening);
          serverInstance.listen(port, host);
        });

      /**
       * Start listening on a Unix socket path.
       */
      const listenSocket = (socketPath: string) =>
        new Promise<void>((resolve, reject) => {
          /**
           * Handle socket listen errors.
           */
          const onError = (err: NodeJS.ErrnoException) => {
            serverInstance.removeListener("listening", onListening);
            reject(err);
          };
          /**
           * Resolve once the socket server is listening.
           */
          const onListening = () => {
            serverInstance.removeListener("error", onError);
            resolve();
          };
          serverInstance.once("error", onError);
          serverInstance.once("listening", onListening);
          serverInstance.listen(socketPath);
        });

      try {
        await listenTcp();
      } catch (err: unknown) {
        const errorInfo = err as { code?: string };
        if (errorInfo?.code === "EPERM") {
          const socketPath =
            process.env.DZX_SOCKET || path.join(os.tmpdir(), `dzx-${normalized.name}.sock`);
          if (fs.existsSync(socketPath)) {
            try {
              fs.unlinkSync(socketPath);
            } catch {
              // ignore cleanup errors
            }
          }
          listenMode = "socket";
          listenValue = socketPath;
          try {
            await listenSocket(socketPath);
          } catch (socketErr: unknown) {
            const socketErrorInfo = socketErr as { code?: string };
            if (socketErrorInfo?.code === "EPERM" && process.env.DZX_DEV === "1") {
              listenMode = "disabled";
              listenValue = "permission denied";
            } else {
              throw socketErr;
            }
          }
        } else {
          throw err;
        }
      }

      if (process.env.DZX_QUIET !== "1") {
        const readyMs = Date.now() - startedAt;
        const name = process.env.DZX_NAME ?? normalized.name;
        if (process.env.DZX_DEV === "1") {
          const devMode = process.env.DZX_DEV_MODE ?? "start";
          const showBanner = process.env.DZX_DEV_BANNER !== "0";
          const version = process.env.DZX_VERSION ?? getDzxVersion();
          const header = `${colorize.blue(symbols.brand)} ${colorize.bold(`dzx v${version}`)} ${colorize.gray("dev")}`;
          const local = `http://localhost:${port}/mcp/${name}`;
          const health = `http://localhost:${port}/health`;
          const status = `http://localhost:${port}/status`;
          const envMode = process.env.DZX_ENV ?? process.env.NODE_ENV ?? "development";
          const logLevel = resolveLogLevel();
          if (devMode === "start") {
            if (showBanner) logDev(header);
            if (listenMode === "socket") {
              logDev(`${colorize.gray("  socket ")} ${colorize.cyan(listenValue)}`);
              logDev(
                `${colorize.gray("  hint   ")} ${colorize.cyan(`curl --unix-socket ${listenValue} http://localhost/`)}`,
              );
            } else if (listenMode === "disabled") {
              logDev(
                `${colorize.gray("  listen ")} ${colorize.yellow("disabled")} ${colorize.dim("(EPERM)")}`,
              );
            } else {
              logDev(`${colorize.gray("  local  ")} ${colorize.cyan(local)}`);
              logDev(`${colorize.gray("  health ")} ${colorize.cyan(health)}`);
              logDev(`${colorize.gray("  status ")} ${colorize.cyan(status)}`);
            }
            logDev(`${colorize.gray("  ready  ")} ${colorize.cyan(`${readyMs}ms`)}`);
            logDev(`${colorize.gray("  env    ")} ${colorize.cyan(envMode)}`);
            logDev(`${colorize.gray("  logs   ")} ${colorize.cyan(logLevel)}`);
            logDev(`${colorize.gray("  timeout")} ${colorize.cyan(`${toolTimeoutMs}ms`)}`);
            logDev("");
          }
        } else {
          const ready =
            listenMode === "disabled"
              ? "Server listening disabled (EPERM)"
              : `Server listening on ${listenMode === "socket" ? listenValue : `http://${host}:${port}`}`;
          logDev(ready);
        }
      }

      if (!signalHandlersAttached) {
        signalHandlersAttached = true;
        /**
         * Close the server and exit on termination signals.
         */
        const shutdown = () => {
          serverInstance.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 250).unref();
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      }

      if (listenMode === "disabled" && process.env.DZX_DEV === "1") {
        // keep process alive when listen is blocked by environment
        setInterval(() => {}, 1 << 30).unref();
      }
    },
  };

  /**
   * Handle a non-streaming JSON-RPC request body.
   */
  async function handleRequest(raw: string, context: unknown): Promise<unknown | null> {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      let batch: JSONRPCRequest[];
      try {
        batch = JSON.parse(raw) as JSONRPCRequest[];
      } catch {
        logDev(`${colorize.red("error")} ${colorize.gray("parse error")}`, "error");
        return invalidRequest(null, "parse error", -32700);
      }
      const responses: JSONRPCResponse[] = [];
      for (const item of batch) {
        const { response, notification } = await handleSingle(item, context);
        if (!notification && response) {
          responses.push(response);
        }
      }
      return responses.length > 0 ? responses : null;
    }

    let request: JSONRPCRequest;
    try {
      request = JSON.parse(raw) as JSONRPCRequest;
    } catch {
      logDev(`${colorize.red("error")} ${colorize.gray("parse error")}`, "error");
      return invalidRequest(null, "parse error", -32700);
    }
    const { response, notification } = await handleSingle(request, context);
    if (notification) return null;
    return response;
  }

  /**
   * Handle a single SSE request body.
   */
  async function handleStream(
    raw: string,
    res: http.ServerResponse,
    context: unknown,
  ): Promise<void> {
    const bodies = splitJsonRpcRequests(raw);
    if (bodies.length === 0) {
      logDev(`${colorize.red("error")} ${colorize.gray("parse error")}`, "error");
      writeSSE(res, invalidRequest(null, "parse error", -32700));
      return;
    }
    for (const body of bodies) {
      let request: JSONRPCRequest;
      try {
        request = JSON.parse(body) as JSONRPCRequest;
      } catch {
        logDev(`${colorize.red("error")} ${colorize.gray("parse error")}`, "error");
        writeSSE(res, invalidRequest(null, "parse error", -32700));
        continue;
      }
      const { response } = await handleSingle(request, context);
      if (response) {
        writeSSE(res, response);
      }
    }
  }

  /**
   * Handle a single JSON-RPC message (request or notification).
   */
  async function handleSingle(
    request: JSONRPCRequest,
    context: unknown,
  ): Promise<{ response?: JSONRPCResponse; notification: boolean }> {
    if (request.jsonrpc !== "2.0") {
      logDev(`${colorize.red("error")} ${colorize.gray("invalid request")}`, "error");
      return {
        response: invalidRequest(request.id ?? null, "invalid request"),
        notification: false,
      };
    }

    const method = normalizeMethod(request.method);
    if (method) {
      logDev(`${colorize.gray("rpc")} ${colorize.cyan(method)}`, "verbose");
    }

    const notification = request.id === undefined || request.id === null;

    switch (method) {
      case "initialize": {
        const params = asRecord(request.params);
        const requestedVersion =
          params && typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
        const manifestVersion = (normalized as { protocolVersion?: string }).protocolVersion;
        const result = {
          protocolVersion:
            typeof requestedVersion === "string" && requestedVersion.length > 0
              ? requestedVersion
              : (manifestVersion ?? DEFAULT_PROTOCOL_VERSION),
          capabilities: {
            tools: { listChanged: true, list: true },
            resources: { listChanged: false },
            prompts: { listChanged: false },
            logging: {},
          },
          serverInfo: {
            name: normalized.name,
            version: normalized.version,
          },
          tools: normalizeToolList(tools),
          resources: resources.map((resource) => ({
            uri: resourceUri(resource.name),
            name: resource.name,
            description: resource.description,
            mimeType: resource.mediaType,
          })),
          prompts: prompts.map((prompt) => ({
            name: prompt.name,
            description: prompt.description,
            arguments: promptArguments(prompt.inputs),
          })),
        };
        return { response: { jsonrpc: "2.0", id: request.id ?? null, result }, notification };
      }
      case "notifications/initialized":
        return { response: undefined, notification: true };
      case "ping":
        return { response: { jsonrpc: "2.0", id: request.id ?? null, result: {} }, notification };
      case "tools/list": {
        return {
          response: {
            jsonrpc: "2.0",
            id: request.id ?? null,
            result: { tools: normalizeToolList(tools) },
          },
          notification,
        };
      }
      case "tools/call": {
        const toolStart = Date.now();
        const params = asRecord(request.params) ?? {};
        const nameValue = params.name;
        const toolName = typeof nameValue === "string" ? nameValue : undefined;
        const args = "arguments" in params ? params.arguments : undefined;
        const callArgs = args ?? {};
        if (!toolName) {
          logDev(`${colorize.red("error")} ${colorize.gray("invalid params")}`, "error");
          recordError(metrics, "invalid params");
          return {
            response: invalidRequest(request.id ?? null, "invalid params", -32602),
            notification,
          };
        }
        const tool = tools.find((item) => item.name === toolName);
        if (!tool) {
          logDev(`${colorize.red("error")} ${colorize.gray(`unknown tool ${toolName}`)}`, "error");
          recordError(metrics, `unknown tool ${toolName}`, toolName);
          return {
            response: invalidRequest(request.id ?? null, "unknown tool", -32602),
            notification,
          };
        }
        if (tool.inputSchema) {
          const validation = validateSchema(tool.inputSchema, callArgs);
          if (!validation.ok) {
            const elapsed = Date.now() - toolStart;
            const location = formatToolLocation(tool);
            const errorText = `${validation.error ?? "input validation failed"} (${location})`;
            logDev(
              `${colorize.red("error")} ${colorize.gray(`input invalid for ${toolName}`)} ${colorize.dim(errorText)}`,
              "error",
            );
            recordToolCall(metrics, toolName, elapsed, errorText);
            return {
              response: invalidRequest(request.id ?? null, "input validation failed", -32602),
              notification,
            };
          }
        }
        try {
          const modulePath = path.resolve(cwd, tool.file);
          const mod = await loadToolModule(modulePath);
          const fn = mod.default;
          if (typeof fn !== "function") {
            const elapsed = Date.now() - toolStart;
            logDev(
              `${colorize.red("error")} ${colorize.gray(`handler missing for ${toolName}`)}`,
              "error",
            );
            recordToolCall(metrics, toolName, elapsed, "handler missing");
            return {
              response: invalidRequest(request.id ?? null, "tool handler not found", -32601),
              notification,
            };
          }
          if (fn.constructor?.name !== "AsyncFunction") {
            const elapsed = Date.now() - toolStart;
            const location = formatToolLocation(tool);
            const errorText = `tool handler must be async (${location})`;
            logDev(`${colorize.red("error")} ${colorize.gray(errorText)}`, "error");
            recordToolCall(metrics, toolName, elapsed, errorText);
            return {
              response: invalidRequest(request.id ?? null, "tool handler must be async", -32601),
              notification,
            };
          }
          // Pass context as the second argument
          const output = await withTimeout(
            Promise.resolve(fn(callArgs, context)),
            toolTimeoutMs,
            toolName,
          );
          const text = typeof output === "string" ? output : JSON.stringify(output ?? {});
          const result: {
            content: Array<{ type: string; text: string }>;
            isError: boolean;
            structuredContent?: unknown;
          } = {
            content: [{ type: "text", text }],
            isError: false,
          };
          const requiresStructured =
            Boolean(tool.outputSchemaSource) && tool.outputSchemaSource !== "default";
          if (requiresStructured && output === undefined) {
            const elapsed = Date.now() - toolStart;
            const location = formatToolLocation(tool);
            const errorText = `structured output required for ${toolName} (${location})`;
            logDev(`${colorize.red("error")} ${colorize.gray(errorText)}`, "error");
            recordToolCall(metrics, toolName, elapsed, errorText);
            const errorResult = {
              content: [{ type: "text", text: errorText }],
              isError: true,
            };
            return {
              response: { jsonrpc: "2.0", id: request.id ?? null, result: errorResult },
              notification,
            };
          }
          if (tool.outputSchema) {
            const validation = validateSchema(tool.outputSchema, output);
            if (!validation.ok) {
              const location = formatToolLocation(tool);
              const errorText = `${validation.error ?? "output validation failed"} (${location})`;
              logDev(
                `${colorize.red("error")} ${colorize.gray(`output invalid for ${toolName}`)} ${colorize.dim(errorText)}`,
                "error",
              );
              const errorResult = {
                content: [{ type: "text", text: errorText }],
                isError: true,
              };
              const elapsed = Date.now() - toolStart;
              recordToolCall(metrics, toolName, elapsed, errorText);
              return {
                response: { jsonrpc: "2.0", id: request.id ?? null, result: errorResult },
                notification,
              };
            }
          }
          if (requiresStructured) {
            result.structuredContent = output;
          } else if (output !== null && typeof output === "object") {
            result.structuredContent = output;
          }
          if (result.structuredContent !== undefined) {
            const structuredValue = result.structuredContent;
            const keys =
              structuredValue &&
              typeof structuredValue === "object" &&
              !Array.isArray(structuredValue)
                ? Object.keys(structuredValue as Record<string, unknown>)
                : [];
            const keyList = keys.length > 0 ? ` keys: ${keys.join(", ")}` : "";
            const typeLabel =
              keys.length === 0
                ? ` type: ${Array.isArray(structuredValue) ? "array" : typeof structuredValue}`
                : "";
            logDev(
              `${colorize.cyan("structured")} ${colorize.gray(toolName)}${colorize.dim(keyList || typeLabel)}`,
              "verbose",
            );
          }
          const elapsed = Date.now() - toolStart;
          logDev(
            `${colorize.cyan("tool")} ${colorize.gray(toolName)} ${colorize.dim(`in ${elapsed}ms`)}`,
            "info",
          );
          recordToolCall(metrics, toolName, elapsed);
          return { response: { jsonrpc: "2.0", id: request.id ?? null, result }, notification };
        } catch (error) {
          const elapsed = Date.now() - toolStart;
          const message = (error as Error).message || "tool error";
          logDev(
            `${colorize.red("tool")} ${colorize.gray(toolName)} ${colorize.dim(`in ${elapsed}ms`)} ${colorize.red(message)}`,
            "error",
          );
          recordToolCall(metrics, toolName, elapsed, message);
          const result = {
            content: [{ type: "text", text: (error as Error).message || "tool error" }],
            isError: true,
          };
          return { response: { jsonrpc: "2.0", id: request.id ?? null, result }, notification };
        }
      }
      case "resources/list": {
        const list = resources.map((resource) => ({
          uri: resourceUri(resource.name),
          name: resource.name,
          description: resource.description,
          mimeType: resource.mediaType,
        }));
        return {
          response: { jsonrpc: "2.0", id: request.id ?? null, result: { resources: list } },
          notification,
        };
      }
      case "resources/read": {
        const params = asRecord(request.params) ?? {};
        const uri = typeof params.uri === "string" ? params.uri : undefined;
        if (!uri) {
          return {
            response: invalidRequest(request.id ?? null, "invalid params", -32602),
            notification,
          };
        }
        const resource = resources.find(
          (item) => resourceUri(item.name) === uri || item.file === uri,
        );
        if (!resource) {
          return {
            response: invalidRequest(request.id ?? null, "resource not found", -32601),
            notification,
          };
        }
        const filePath = path.resolve(cwd, resource.file);
        const content = fs.readFileSync(filePath, "utf8");
        const result = {
          contents: [
            {
              uri: resourceUri(resource.name),
              mimeType: resource.mediaType ?? "text/markdown",
              text: content,
            },
          ],
        };
        return { response: { jsonrpc: "2.0", id: request.id ?? null, result }, notification };
      }
      case "resources/subscribe":
      case "resources/unsubscribe":
        return { response: { jsonrpc: "2.0", id: request.id ?? null, result: {} }, notification };
      case "prompts/list": {
        const list = prompts.map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: promptArguments(prompt.inputs),
        }));
        return {
          response: { jsonrpc: "2.0", id: request.id ?? null, result: { prompts: list } },
          notification,
        };
      }
      case "prompts/get": {
        const params = asRecord(request.params) ?? {};
        const name = typeof params.name === "string" ? params.name : undefined;
        if (!name) {
          return {
            response: invalidRequest(request.id ?? null, "invalid params", -32602),
            notification,
          };
        }
        const prompt = prompts.find((item) => item.name === name);
        if (!prompt) {
          return {
            response: invalidRequest(request.id ?? null, "prompt not found", -32601),
            notification,
          };
        }
        const filePath = path.resolve(cwd, prompt.file);
        const content = fs.readFileSync(filePath, "utf8");
        const parsed = parseFrontmatter(content);
        const result = {
          prompt: {
            name: prompt.name,
            description: prompt.description,
            arguments: promptArguments(prompt.inputs),
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: parsed.body.trim() }],
              },
            ],
          },
        };
        return { response: { jsonrpc: "2.0", id: request.id ?? null, result }, notification };
      }
      case "logging/setLevel":
        return { response: { jsonrpc: "2.0", id: request.id ?? null, result: {} }, notification };
      case "notifications/cancelled":
      case "notifications/canceled":
        return { response: undefined, notification: true };
      default: {
        const rawMethod = request.method ?? "unknown";
        const normalizedMethod = method ?? rawMethod;
        logDev(
          `${colorize.red("error")} ${colorize.gray("method not found")} ${colorize.dim(`raw=${rawMethod} normalized=${normalizedMethod}`)}`,
          "error",
        );
        return {
          response: {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: {
              code: -32601,
              message: "method not found",
              data: { method: rawMethod, normalized: normalizedMethod },
            },
          },
          notification,
        };
      }
    }
  }

  if (options.autoStart !== false) {
    server.start().catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
  }

  return server;
}
