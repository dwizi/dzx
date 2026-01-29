import fs from "node:fs";
import path from "node:path";

/**
 * Return true when the directory is missing or empty.
 */
export function isEmptyDir(dir: string): boolean {
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).length === 0;
}

/**
 * Recursively list files relative to the base directory.
 */
export function listFiles(dir: string, baseDir: string = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath, baseDir));
    } else {
      files.push(path.relative(baseDir, entryPath));
    }
  }
  return files;
}

/**
 * Copy a directory recursively.
 */
export function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Ensure a directory exists.
 */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
