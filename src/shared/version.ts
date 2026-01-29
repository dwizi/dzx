import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

/**
 * Read the package version from the local package.json.
 */
export function getDzxVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "..", "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    cachedVersion = pkg.version ?? "0.0.0";
    return cachedVersion;
  } catch {
    return "0.0.0";
  }
}
