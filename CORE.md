# dzx Core Layout

Goal: maximize shared logic between Node and Deno CLIs.

## Package Structure (proposed)
```
packages/dzx/
  src/
    core/
      manifest/
        load.ts
        validate.ts
      discovery/
        tools.ts
        resources.ts
        prompts.ts
      schema/
        jsdoc.ts
        json-schema.ts
      build/
        bundle.ts
        emit-manifest.ts
      fs/
        paths.ts
        read.ts
      log/
        logger.ts
    cli/
      node/
        dev.ts
        inspect.ts
        validate.ts
        build.ts
      deno/
        dev.ts
        inspect.ts
        validate.ts
        build.ts
    runtime/
      index.ts
```

## Core Modules
- `manifest`: parse and validate `mcp.json`.
- `discovery`: enumerate tools/resources/prompts.
- `schema`: extract JSDoc metadata and attach JSON Schema.
- `build`: invoke bundler and emit `tool-manifest.json`.
- `fs`: path normalization and sandbox-safe reads.
- `log`: unified logger with quiet/verbose modes.

## Cross-runtime rules
- Core modules avoid Node/Deno globals where possible.
- CLI adapters handle runtime-specific details (watchers, process spawning).
