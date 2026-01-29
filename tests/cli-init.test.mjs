import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInit } from "../dist/cli/init.js";

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dzx-init-"));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("create-dzx scaffold supports --no-install", async () => {
  await withTempDir(async (dir) => {
    await runInit({
      mode: "scaffold",
      argv: ["--dir", dir, "--template", "basic", "--runtime", "node", "--yes", "--no-install"],
    });
    assert.ok(fs.existsSync(path.join(dir, "mcp.json")));
    assert.ok(fs.existsSync(path.join(dir, "tools")));
    assert.ok(!fs.existsSync(path.join(dir, "node_modules")));
  });
});

test("create-dzx scaffold honors installDeps option", async () => {
  await withTempDir(async (dir) => {
    await runInit({
      mode: "scaffold",
      installDeps: false,
      argv: ["--dir", dir, "--template", "basic", "--runtime", "node", "--yes"],
    });
    assert.ok(fs.existsSync(path.join(dir, "mcp.json")));
    assert.ok(!fs.existsSync(path.join(dir, "node_modules")));
  });
});
