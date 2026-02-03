#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_DIR = join(__dirname, "..");
const PACKAGE_JSON = join(PACKAGE_DIR, "package.json");

// Read the main package.json to get the current version
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
const version = packageJson.version;

if (!version) {
  console.error("Error: No version found in package.json");
  process.exit(1);
}

console.log(`Updating template versions to ${version}...`);

// Template directories
const templates = ["basic", "tools-only", "full"];

for (const template of templates) {
  const templatePackageJsonPath = join(PACKAGE_DIR, "templates", template, "package.json");
  const templatePackageJson = JSON.parse(readFileSync(templatePackageJsonPath, "utf-8"));
  
  if (templatePackageJson.dependencies?.["@dwizi/dzx"]) {
    templatePackageJson.dependencies["@dwizi/dzx"] = `^${version}`;
    writeFileSync(templatePackageJsonPath, JSON.stringify(templatePackageJson, null, 2) + "\n");
    console.log(`  ✓ Updated ${template}/package.json`);
  } else {
    console.warn(`  ⚠ No @dwizi/dzx dependency found in ${template}/package.json`);
  }
}

console.log("Template versions updated successfully!");
