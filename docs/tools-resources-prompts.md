# Tools, Resources, and Prompts

dzx is file-driven. Your folder structure determines what the server exposes.

## Tools

### File conventions

- Tools live in `tools/` (or `toolsDir` in `mcp.json`).
- Each tool file must export a **default async function**.
- The tool name is derived from the path:
  - `tools/hello.ts` -> `hello`
  - `tools/user/profile.ts` -> `user-profile`

### Description

The JSDoc summary above the default export is used as the tool description.

```ts
/**
 * Returns a user profile.
 */
export default async function profile(input: { userId: string }) {
  return { id: input.userId };
}
```

### Schemas

You can provide schemas explicitly or let dzx infer them.

1) Explicit schemas (recommended):

```ts
import { z } from "zod";
import { defineSchema } from "@dwizi/dzx/schema";

export default async function add(input: { a: number; b: number }) {
  return { sum: input.a + input.b };
}

export const schema = {
  input: defineSchema(z.object({ a: z.number(), b: z.number() })),
  output: defineSchema(z.object({ sum: z.number() })),
};
```

2) JSDoc inference:

```ts
/**
 * Multiply numbers.
 * @param {object} input
 * @param {number} input.a
 * @param {number} [input.b]
 * @returns {{ product: number }}
 */
export default async function multiply(input) {
  return { product: input.a * (input.b ?? 1) };
}
```

3) Type signature inference:

```ts
export default async function greet(input: { name: string }): Promise<{ message: string }> {
  return { message: `Hi ${input.name}` };
}
```

If dzx cannot infer schemas, it falls back to permissive defaults and emits a warning in dev.

## Resources

Resources are Markdown files in `resources/`.

Optional frontmatter:

```md
---
name: getting-started
description: Quick overview
---
# Getting Started
...
```

Rules:
- If `name` is omitted, dzx uses the filename.
- Resources are exposed as `resource://<name>` URIs.
- Media type defaults to `text/markdown`.

## Prompts

Prompts are Markdown files in `prompts/` with optional frontmatter.

```md
---
name: summarize
description: Summarize text in three bullets
inputs:
  - name: text
    type: string
    description: The text to summarize
---
Summarize the following:
{{text}}
```

Rules:
- If `name` is omitted, dzx uses the filename.
- `inputs` defines prompt arguments exposed to the client.
- The prompt body is the Markdown content below frontmatter.

## File naming tips

- Use kebab-case for file names for predictable tool names.
- Keep tool files small and single-purpose.
- Use nested folders to group tools (names are flattened with dashes).
