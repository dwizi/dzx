import fs from "node:fs";
import path from "node:path";
import { match } from "ts-pattern";
import { z } from "zod";

const ManifestSchema = z
  .object({
    name: z.string().min(1, "name must not be empty"),
    version: z.string().min(1, "version must not be empty"),
    runtime: z.enum(["node", "deno"], { message: "runtime must be node or deno" }),
    entry: z.string().min(1, "entry must not be empty"),
    protocolVersion: z.string().optional(),
    mcp: z
      .object({
        methods: z
          .object({
            resourcesTemplatesList: z.boolean().optional(),
            completionComplete: z.boolean().optional(),
            notificationsComplete: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    toolsDir: z.string().optional(),
    resourcesDir: z.string().optional(),
    promptsDir: z.string().optional(),
    permissions: z
      .object({
        network: z.boolean().optional(),
        filesystem: z
          .object({
            read: z.array(z.string()).optional(),
            write: z.array(z.string()).optional(),
          })
          .optional(),
      })
      .optional(),
    build: z
      .object({
        command: z.string().optional(),
        output: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.build?.command && !value.build.output) {
      ctx.addIssue({
        code: "custom",
        message: "build.command requires build.output",
        path: ["build", "output"],
      });
    }
  });

export type Manifest = z.infer<typeof ManifestSchema>;

export type ManifestLoadResult = {
  manifest: Manifest;
  manifestPath: string;
};

/**
 * Load and parse the MCP manifest from disk.
 */
export function loadManifest(cwd: string, configPath?: string): ManifestLoadResult {
  const manifestPath = path.resolve(cwd, configPath ?? "mcp.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as Manifest;
  return { manifest, manifestPath };
}

/**
 * Normalize manifest defaults for optional directories.
 */
export function normalizeManifest(manifest: Manifest): Manifest {
  return {
    ...manifest,
    toolsDir: manifest.toolsDir ?? "tools",
    resourcesDir: manifest.resourcesDir ?? "resources",
    promptsDir: manifest.promptsDir ?? "prompts",
  };
}

/**
 * Validate a manifest and return human-friendly errors.
 */
export function validateManifest(manifest: Manifest): string[] {
  const result = ManifestSchema.safeParse(manifest);
  if (result.success) return [];

  return result.error.issues.map((issue) => {
    const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "manifest";
    return match(issue)
      .with(
        { code: "invalid_type", received: "undefined" },
        () => `missing required field "${pathLabel}"`,
      )
      .with({ code: "invalid_value" }, () => {
        const received =
          "received" in issue ? (issue as { received?: unknown }).received : undefined;
        return `unsupported runtime: ${received ?? "unknown"}`;
      })
      .with({ code: "unrecognized_keys" }, () => {
        const keys = "keys" in issue ? ((issue as { keys?: string[] }).keys ?? []) : [];
        return keys.length > 0
          ? `unknown field(s): ${keys.join(", ")}`
          : "unknown fields in manifest";
      })
      .with({ code: "too_small" }, () => `field "${pathLabel}" must not be empty`)
      .with({ code: "custom" }, () => issue.message)
      .otherwise(() => `invalid ${pathLabel}: ${issue.message}`);
  });
}

/**
 * Resolve a repo-relative path.
 */
export function resolveRepoPath(cwd: string, relativePath: string): string {
  return path.resolve(cwd, relativePath);
}

/**
 * Check that a repo-relative path exists on disk.
 */
export function existsWithinRepo(cwd: string, relativePath: string): boolean {
  const full = resolveRepoPath(cwd, relativePath);
  return fs.existsSync(full);
}
