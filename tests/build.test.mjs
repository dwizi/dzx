import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runBuild } from "../dist/cli/commands.js";

const fixture = path.resolve(process.cwd(), "tests/fixtures/build-split");
const invalidFixture = path.resolve(process.cwd(), "tests/fixtures/invalid-tool");
const sortFixture = path.resolve(process.cwd(), "tests/fixtures/build-sort");

test("Build: split-tools bundles one file per tool", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dzx-build-"));
  try {
    fs.cpSync(fixture, tempDir, { recursive: true });
    await runBuild([
      "--cwd",
      tempDir,
      "--config",
      "mcp.json",
      "--out-dir",
      "dist",
      "--split-tools",
    ]);

    const manifestPath = path.join(tempDir, "dist", "tool-manifest.json");
    assert.ok(fs.existsSync(manifestPath), "tool-manifest.json should be written");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.strictEqual(manifest.toolFormat, "esm");
    assert.strictEqual(manifest.tools.length, 2);
    const toolNames = manifest.tools.map((tool) => tool.name);
    assert.deepStrictEqual(toolNames, [...toolNames].sort(), "tools should be sorted by name");

    const files = manifest.tools.map((tool) => tool.file);
    const uniqueFiles = new Set(files);
    assert.strictEqual(uniqueFiles.size, files.length, "each tool should have its own bundle");

    for (const tool of manifest.tools) {
      const absolute = path.join(tempDir, tool.file);
      assert.ok(fs.existsSync(absolute), `bundle missing: ${tool.file}`);
      const mod = await import(pathToFileURL(absolute).href);
      assert.strictEqual(typeof mod.default, "function");
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Build: fails when tool default export is not async", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dzx-build-invalid-"));
  try {
    fs.cpSync(invalidFixture, tempDir, { recursive: true });
    await assert.rejects(
      () =>
        runBuild(["--cwd", tempDir, "--config", "mcp.json", "--out-dir", "dist", "--split-tools"]),
      /default export must be async/i,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Build: manifest lists tools/resources/prompts in sorted order", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dzx-build-sort-"));
  try {
    fs.cpSync(sortFixture, tempDir, { recursive: true });
    await runBuild([
      "--cwd",
      tempDir,
      "--config",
      "mcp.json",
      "--out-dir",
      "dist",
      "--split-tools",
    ]);

    const manifestPath = path.join(tempDir, "dist", "tool-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const toolNames = manifest.tools.map((tool) => tool.name);
    const resourceNames = manifest.resources.map((resource) => resource.name);
    const promptNames = manifest.prompts.map((prompt) => prompt.name);

    assert.deepStrictEqual(toolNames, ["alpha", "mid", "zeta"]);
    assert.deepStrictEqual(resourceNames, ["a", "b", "c"]);
    assert.deepStrictEqual(promptNames, ["a", "m", "z"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
