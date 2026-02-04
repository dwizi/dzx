# Scaffolding with @dwizi/create-dzx

`@dwizi/create-dzx` is the fastest way to start a dzx project. It generates a ready-to-run repo with a manifest, server entrypoint, and starter tools.

## Usage

```bash
npx @dwizi/create-dzx@latest
```

Or with options:

```bash
npx @dwizi/create-dzx@latest my-agent --template basic --runtime node
```

## What it creates

Depending on the template, the scaffold includes:
- `mcp.json`
- `src/server.ts` (runtime entrypoint)
- `tools/` with a sample tool
- `resources/` and `prompts/` (for templates that include content)
- Package scripts for `dev`, `inspect`, and `build`

## Templates

- **basic** -- tools + resources + prompts (recommended starting point)
- **tools-only** -- minimal template with tools only
- **full** -- includes example tools and content

## Options

- `--dir <path>` target directory (default: `my-agent`)
- `--template <basic|tools-only|full>` template to scaffold
- `--runtime <node|deno>` runtime to configure
- `--install` install dependencies after scaffolding
- `--no-install` skip dependency installation
- `--yes` accept defaults
- `--force` overwrite existing files

## Notes

- `@dwizi/create-dzx` is the scaffolded entrypoint. `dzx init` provides the same functionality inside an existing folder.
- The tool detects your package manager by looking for lockfiles. If none exist, it defaults to `pnpm`.
