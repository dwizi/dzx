# Roadmap: dzx (MCP Framework)

Goal: ship a running `@dwizi/dzx` that standardizes MCP apps, provides a clean local dev UX, and produces deployable bundles for the dwizi import flow.

---

## Product Principles
- Opinionated but minimal: clear defaults, explicit overrides.
- Safe-by-default: least-privilege permissions and pinned versions.
- DX first: predictable structure, excellent CLI, great docs.
- Runtime parity: Node + Deno with shared semantics.

---

## Spec v0 (MVP)

### 1) Manifest (`mcp.json`)
**Required fields**
- `name` (slug, lowercase)
- `version` (semver)
- `runtime`: `node | deno`
- `entry`: relative path (server entrypoint)

**Optional fields**
- `toolsDir`, `resourcesDir`, `promptsDir`
- `permissions`: `network`, `filesystem.read`, `filesystem.write`
- `build`: `command`, `output`, `env`

**Validation rules**
- All paths must be relative and within repo.
- `build.command` requires `build.output`.
- If omitted, directories default to `tools`, `resources`, `prompts`.

---

## Feature Plan

### Phase 0 — Tooling Foundations (Week 1)
**Feature: schema + validator**
- JSON schema published at `packages/dzx/mcp.schema.json`.
- `dzx validate` validates manifest, paths, and directory presence.

**Feature: tool discovery (static)**
- Scan `toolsDir` for source files.
- Require one default export per tool file (async).
- Capture metadata via JSDoc and optional schema object.

**Metadata extraction rules**
- Tool name: derived from file path (e.g. `tools/smart-hello.ts` → `smart-hello`).
- Description: JSDoc summary line (first line).
- Input schema:
  - Prefer `export const schema = { input, output }` using `defineSchema(zodSchema)` (Zod-first).
  - Accept plain JSON Schema objects for `input`/`output`.
  - Also allow `toolSchema`, `defaultSchema`, or `<camelName>Schema` (legacy).
  - Fallback to JSDoc params to build a simple schema if possible.
- Output schema: from `schema.output` (or equivalent alias) if present.

**Deliverables**
- CLI command `dzx inspect` prints tool list + metadata.
- Markdown doc describing tool JSDoc format and schema conventions.

---

### Phase 1 — Runtime Adapter (Week 2–3)
**Feature: server runtime**
- `@dwizi/dzx/runtime` provides MCP server bootstrap.
- Accepts tool registry, resource registry, prompt registry.

**Feature: resource registry**
- Read `.md` files in `resourcesDir`.
- Optional frontmatter: `name`, `description`.
- Default name = file basename.

**Feature: prompt registry**
- Read `.md` files in `promptsDir`.
- Optional frontmatter: `name`, `description`, `inputs`.
- Support mustache-style placeholders `{{inputName}}`.

**Runtime parity**
- Node: uses `node` runtime adapter.
- Deno: uses `deno` adapter (same registry behavior).

---

### Phase 2 — Local Dev Experience (Week 4)
**Feature: `dzx dev`**
- Hot reload of tools/resources/prompts on file change.
- Watches `mcp.json` for changes.
- Prints available tools at startup.

**Feature: terminal UX**
- Use runtime-appropriate CLIs with shared core logic:
  - Node CLI: lightweight formatter + prompts
  - Deno CLI: Cliffy
  - Optional: Go-based TUI (Bubble Tea + Lip Gloss) as a separate binary

**CLI aesthetics**
- Clean spinners, status panels, and “deployed tools” table.
- Minimal noise by default; `--verbose` for logs.

### Phase 2b — CLI Runtimes & Compatibility
**Shared core package**
- `@dwizi/dzx/core` contains:
  - manifest parsing/validation
  - tool/resource/prompt discovery
  - build/bundle pipeline logic

**Node CLI**
- `@dwizi/dzx` (Node entrypoint)
- Uses core package, implements `dev/inspect/validate/build`

**Deno CLI**
- `@dwizi/dzx-deno` (Deno entrypoint)
- Uses core package via `jsr:` or npm compatibility
- Mirrors Node CLI commands and flags

**Optional Go TUI**
- `dzx-tui` binary (Bubble Tea)
- Wraps the Node/Deno CLI as a backend

---

### Phase 3 — Build & Bundling (Week 5–6)
**Feature: `dzx build`**
- Produces deployable bundles for dwizi import.
- Bundle output:
  - `/dist/server.js` (runtime bootstrap)
  - `/dist/tools/*` (tool modules)
  - `/dist/manifest.json` (tool metadata + schemas)

**Bundler choice**
- Default: `esbuild` (fast, simple, stable).
- Optional: `tsup` wrapper if needed for TS config + types.
- Deno: use `deno bundle` or `esbuild` via `deno_esbuild`.

**Bundling rules**
- One-file-per-tool bundle option:
  - `dzx build --split-tools`
  - Output `dist/tools/<toolName>.js`
  - Allows per-tool execution isolation in gateway.

**Schema emission**
- Build generates a `tool-manifest.json`:
  - tool name, description, input schema, output schema, file path
  - version and runtime info

---

### Phase 4 — Hosted Import Compatibility (Week 7)
**Feature: deterministic build**
- All builds pinned by commit SHA.
- Optional `--frozen-lockfile` support for Node installs.

**Feature: runtime sandbox config**
- Extract `permissions` from manifest for gateway policies.
- Default: no network, no FS write.

**Feature: gateway integration expectations**
- `tool-manifest.json` is the contract with dwizi import.
- Deploy pipeline reads this manifest to register tools.

---

## Technical Decisions (explicit)
- **Schema source**: Zod-first (via `defineSchema`) with JSON Schema output; plain JSON Schema supported.
- **Tool description source**: JSDoc summary line.
- **Input/Output schema**: `<toolName>Schema` export (JSON Schema).
- **Bundler**: esbuild by default.
- **Per-tool execution**: build `--split-tools` output option.
- **CLI**: Node/Deno CLIs; optional Charm-based TUI as a separate binary.

## Create-dzx (Scaffolding)
**Command**
- `npx create-dzx@latest`

**Flow**
- Prompt for runtime: `node` | `deno`
- Prompt for template: `basic` | `tools-only` | `full`
- Generate `mcp.json`, directories, sample tool, and README
- Optional `--no-install`, `--git`, `--example` flags

**Templates**
- `basic`: empty tool + hello prompt/resource
- `tools-only`: no resources/prompts
- `full`: example tool + resource + prompt + local dev script

---

## Deliverable Checklist
- [x] `mcp.json` schema + validator
- [x] tool/resource/prompt discovery
- [x] `dzx inspect`
- [x] Node runtime adapter
- [ ] Deno runtime adapter
- [x] `dzx dev` hot reload
- [x] `dzx build` + `--split-tools`
- [x] `tool-manifest.json` output
- [x] docs + examples

---

## Readiness Gaps (Current)

### P0 — Must‑Have for “It Just Works”
- [x] **Schema inference + validation guarantees**: finish the inference ladder (JSDoc → signature → fallback) with deterministic rules + better error messaging when inference fails.
- [x] **Tool contract enforcement**: verify a default async function exists and returns structured output when `outputSchema` is defined; actionable error with file + line.
- [x] **Build determinism**: consistent tool bundling (per‑tool output), stable manifest ordering, and clear, reproducible output.
- [x] **Dev server correctness**: tools/resources/prompts always reflect latest build; no stale cache; hot reload works across tools/resources/prompts/env.
- [x] **CLI UX consistency**: align output across `build`, `dev`, `inspect`, `init`; high‑signal logs; consistent header + footer.
- [x] **Testing baseline**: fixtures + golden outputs for manifest, schema inference, runtime tool calls, and failure cases.

### P1 — Polish + “Framework Feel”
- [ ] **First‑class DX docs**: one page “Getting Started” + “Why dzx” + “Build vs Dev vs Runtime” + “Deploy to dwizi.”
- [ ] **Templates**: at least 2 high‑quality templates (basic + advanced) that show schema authoring best practice.
- [ ] **Local dev dashboard**: improve/standardize dashboard and `/status` with tool usage counts + last error; the `/` HTML dashboard should match the `apps/web` styling.
- [ ] **Error taxonomy**: consistent error codes/messages across CLI + runtime (e.g., `DZXE_*`).
- [ ] **CLI plugins**: a place for future plugins (formatters, telemetry, custom build steps).

---

## Success Criteria
- A sample repo can be booted locally with `dzx dev`.
- `dzx build` produces a deployable bundle and tool manifest.
- A tool can run standalone from the bundled file in the gateway.
