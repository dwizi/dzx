import fs from "node:fs";
import path from "node:path";

/**
 * Normalize a dotenv value, honoring quoted strings and \n escapes.
 */
function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unquoted = trimmed.slice(1, -1);
    return unquoted.replace(/\\n/g, "\n");
  }
  return trimmed;
}

/**
 * Parse a dotenv file into key/value pairs.
 */
function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice("export ".length) : line;
    const idx = cleaned.indexOf("=");
    if (idx === -1) continue;
    const key = cleaned.slice(0, idx).trim();
    const value = cleaned.slice(idx + 1);
    if (!key) continue;
    env[key] = parseEnvValue(value);
  }
  return env;
}

/**
 * Load env files in precedence order for the given mode.
 */
export function loadEnvFiles(cwd: string, mode: string): Record<string, string> {
  const env: Record<string, string> = {};
  const files = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];

  for (const file of files) {
    const fullPath = path.resolve(cwd, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const contents = fs.readFileSync(fullPath, "utf8");
      const parsed = parseEnvFile(contents);
      Object.assign(env, parsed);
    } catch {
      // ignore malformed env files in dev
    }
  }

  return env;
}
