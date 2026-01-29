#!/usr/bin/env node

import { runBuild, runDev, runInspect, runValidate } from "./commands.js";
import { formatListItem, printBanner, printSection } from "./console.js";
import { runInit } from "./init.js";

/**
 * Entry point for the dzx CLI.
 */
async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printBanner("help");
    // eslint-disable-next-line no-console
    console.log(`${"Usage".padEnd(6)} ${"dzx <command>"}\n`);
    printSection("Commands");
    const items = [
      { label: "init", description: "initialize or scaffold a new MCP project" },
      { label: "dev", description: "run local MCP server with hot reload" },
      { label: "inspect", description: "list tools, resources, and prompts" },
      { label: "validate", description: "validate mcp.json and directories" },
      { label: "build", description: "build a deployable bundle" },
    ];
    for (const item of items) {
      // eslint-disable-next-line no-console
      console.log(`  ${formatListItem(item.label, item.description)}`);
    }
    // eslint-disable-next-line no-console
    console.log("\nRun `dzx <command> --help` for command options.");
    process.exit(0);
  }

  switch (command) {
    case "init":
      await runInit({ mode: "init", argv: rest });
      return;
    case "dev":
      await runDev(rest);
      return;
    case "inspect":
      await runInspect(rest);
      return;
    case "validate":
      await runValidate(rest);
      return;
    case "build":
      await runBuild(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
