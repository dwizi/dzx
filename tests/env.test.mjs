import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadEnvFiles } from "../dist/core/env.js";

test("loadEnvFiles respects precedence and mode", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dzx-env-"));
  fs.writeFileSync(path.join(tmpDir, ".env"), "BASE=one\nSHARED=from-env\n");
  fs.writeFileSync(path.join(tmpDir, ".env.local"), "LOCAL=two\nSHARED=from-local\n");
  fs.writeFileSync(path.join(tmpDir, ".env.development"), "MODE=dev\nSHARED=from-mode\n");
  fs.writeFileSync(path.join(tmpDir, ".env.development.local"), "MODE=dev-local\n");

  const result = loadEnvFiles(tmpDir, "development");

  assert.equal(result.BASE, "one");
  assert.equal(result.LOCAL, "two");
  assert.equal(result.MODE, "dev-local");
  assert.equal(result.SHARED, "from-mode");
});
