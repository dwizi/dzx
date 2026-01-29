#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyDir, isEmptyDir, listFiles } from "../core/fs.js";
import { getDzxVersion } from "../shared/version.js";
import { parseArgs } from "./args.js";
import { printHelp, printKeyValueList } from "./console.js";
import { colorize, symbols } from "./format.js";
import { runCommand } from "./run-command.js";
import { createSpinner } from "./spinner.js";

const TEMPLATES = ["basic", "tools-only", "full"] as const;
const RUNTIMES = ["node", "deno"] as const;

type Template = (typeof TEMPLATES)[number];
type Runtime = (typeof RUNTIMES)[number];

type InitOptions = {
  mode?: "init" | "scaffold";
  argv?: string[];
  installDeps?: boolean;
};

/**
 * Normalize a string into a filesystem-safe slug.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Lazy-load clack prompts to keep startup light.
 */
async function loadClack() {
  const loader = new Function("return import('@clack/prompts')");
  return loader() as Promise<typeof import("@clack/prompts")>;
}

/**
 * Resolve the templates directory for create-dzx.
 */
function resolveTemplatesRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const localTemplatesRoot = path.resolve(here, "..", "..", "templates");
  if (fs.existsSync(localTemplatesRoot)) return localTemplatesRoot;
  return path.resolve(process.cwd(), "node_modules", "@dwizi", "dzx", "templates");
}

/**
 * Initialize or scaffold a new dzx project.
 */
export async function runInit(options: InitOptions = {}): Promise<void> {
  const args = parseArgs(options.argv ?? process.argv.slice(2));
  const mode = options.mode ?? "init";
  const force = Boolean(args.force);
  const isYes = Boolean(args.yes);
  const shouldInstall = args.install
    ? true
    : args["no-install"]
      ? false
      : (options.installDeps ?? mode === "scaffold");
  const version = getDzxVersion();
  if (args.help || args.h) {
    const usage = mode === "scaffold" ? "create-dzx [options]" : "dzx init [options]";
    printHelp(mode === "scaffold" ? "create" : "init", usage, [
      { flag: "--dir <path>", description: "target directory (default: .)" },
      { flag: "--template <basic|tools-only|full>", description: "template to scaffold" },
      { flag: "--runtime <node|deno>", description: "runtime to configure" },
      { flag: "--install", description: "install dependencies after scaffolding" },
      { flag: "--no-install", description: "skip dependency installation" },
      { flag: "--yes", description: "accept defaults" },
      { flag: "--force", description: "overwrite existing files" },
    ]);
    return;
  }

  const dirArg = (args.dir as string | undefined) ?? args.positional[0];
  const defaultDir = mode === "scaffold" ? "my-agent" : ".";
  const clack = isYes ? null : await loadClack();

  if (clack) {
    clack.intro(mode === "scaffold" ? "create-dzx" : "dzx init");
  }

  let targetDir = path.resolve(process.cwd(), dirArg || defaultDir);
  if (!isYes && clack) {
    const dirResponse = await clack.text({
      message: mode === "scaffold" ? "Project directory" : "Target directory",
      initialValue: dirArg || defaultDir,
    });
    if (clack.isCancel(dirResponse)) {
      clack.cancel("Aborted.");
      process.exit(1);
    }
    targetDir = path.resolve(process.cwd(), dirResponse || defaultDir);
  }

  let template = (args.template as Template | undefined) || (isYes ? "basic" : undefined);
  if (!template && clack) {
    const templateResponse = await clack.select({
      message: "Template",
      options: [
        { value: "basic", label: "basic" },
        { value: "tools-only", label: "tools-only" },
        { value: "full", label: "full" },
      ],
      initialValue: "basic",
    });
    if (clack.isCancel(templateResponse)) {
      clack.cancel("Aborted.");
      process.exit(1);
    }
    template = templateResponse as Template;
  }

  let runtime = (args.runtime as Runtime | undefined) || (isYes ? "node" : undefined);
  if (!runtime && clack) {
    const runtimeResponse = await clack.select({
      message: "Runtime",
      options: [
        { value: "node", label: "node" },
        { value: "deno", label: "deno" },
      ],
      initialValue: "node",
    });
    if (clack.isCancel(runtimeResponse)) {
      clack.cancel("Aborted.");
      process.exit(1);
    }
    runtime = runtimeResponse as Runtime;
  }

  template = template ?? "basic";
  runtime = runtime ?? "node";

  if (!TEMPLATES.includes(template)) {
    throw new Error(`Unknown template: ${template}`);
  }
  if (!RUNTIMES.includes(runtime)) {
    throw new Error(`Unknown runtime: ${runtime}`);
  }

  if (mode === "scaffold" && !force && !isEmptyDir(targetDir)) {
    throw new Error(`Target directory is not empty: ${targetDir}. Use --force to overwrite.`);
  }

  const templatesRoot = resolveTemplatesRoot();
  const templateDir = path.join(templatesRoot, template);
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template not found: ${template}`);
  }

  if (force && !isYes && clack) {
    const confirmation = await clack.confirm({
      message: "This will overwrite existing files. Continue?",
      initialValue: false,
    });
    if (clack.isCancel(confirmation) || confirmation === false) {
      clack.cancel("Aborted.");
      process.exit(1);
    }
  }

  const spinner = createSpinner(process.stdout.isTTY);
  const stepLabels = [
    "Validating destination",
    "Copying template",
    "Configuring manifest",
    ...(shouldInstall ? ["Installing dependencies"] : []),
    "Finalizing",
  ];
  const stepLabelWidth = stepLabels.reduce((max, label) => Math.max(max, label.length), 0);
  const stepTimes: Array<{ label: string; ms: number }> = [];
  let stepStart = Date.now();
  let lastStep = "";
  let spinnerStarted = false;
  /**
   * Print a completed step with elapsed time.
   */
  const logStep = (label: string, ms: number) => {
    const paddedLabel = label.padEnd(stepLabelWidth);
    const paddedMs = `${ms}ms`.padStart(6);
    const line = `${colorize.cyan(symbols.step)} ${colorize.gray(paddedLabel)} ${colorize.dim(paddedMs)}`;
    if (spinner.isEnabled) {
      spinner.pause();
      // eslint-disable-next-line no-console
      console.log(line);
      spinner.resume();
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  };
  /**
   * Advance the init spinner and record the previous step timing.
   */
  const step = (message: string) => {
    const now = Date.now();
    if (lastStep) {
      const ms = now - stepStart;
      stepTimes.push({ label: lastStep, ms });
      logStep(lastStep, ms);
    }
    lastStep = message;
    stepStart = now;
    if (spinner.isEnabled) {
      if (spinnerStarted) {
        spinner.update(message);
      } else {
        spinner.start(message);
        spinnerStarted = true;
      }
    }
  };

  const banner = `${colorize.blue(symbols.brand)} ${colorize.bold(`dzx v${version}`)} ${colorize.gray(mode === "scaffold" ? "create" : "init")}`;
  // eslint-disable-next-line no-console
  console.log(banner);

  step("Validating destination");
  if (!force) {
    const templateFiles = listFiles(templateDir);
    const collisions = templateFiles.filter((file) => fs.existsSync(path.join(targetDir, file)));
    if (collisions.length > 0) {
      const preview = collisions
        .slice(0, 8)
        .map((file) => `- ${file}`)
        .join("\n");
      const suffix = collisions.length > 8 ? "\n- ..." : "";
      throw new Error(
        `Refusing to overwrite existing files. Use --force to proceed.\n${preview}${suffix}`,
      );
    }
  }

  step("Copying template");
  copyDir(templateDir, targetDir);

  step("Configuring manifest");
  const manifestPath = path.join(targetDir, "mcp.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.name = slugify(path.basename(targetDir));
    manifest.runtime = runtime;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  if (shouldInstall) {
    step("Installing dependencies");
    const installCommand = "pnpm install";
    const pkgPath = path.join(targetDir, "package.json");
    if (!fs.existsSync(pkgPath)) {
      if (spinner.isEnabled) spinner.stop();
      throw new Error("Missing package.json in template. Cannot install dependencies.");
    }
    try {
      await runCommand(installCommand, targetDir);
    } catch {
      if (spinner.isEnabled) spinner.stop();
      throw new Error("Dependency installation failed. Run `pnpm install` manually.");
    }
  }

  step("Finalizing");
  if (lastStep) {
    const ms = Date.now() - stepStart;
    stepTimes.push({ label: lastStep, ms });
    logStep(lastStep, ms);
  }
  spinner.stop();

  const totalMs = stepTimes.reduce((sum, item) => sum + item.ms, 0);
  const summaryLines = [
    { label: "dir", value: targetDir },
    { label: "template", value: template },
    { label: "runtime", value: runtime },
    { label: "install", value: shouldInstall ? "yes" : "no" },
    { label: "ready", value: `${totalMs}ms` },
  ];
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(`${colorize.green(symbols.check)} ${colorize.bold("Project ready")}`);
  printKeyValueList(summaryLines);
  const nextSteps = [
    `cd ${path.basename(targetDir)}`,
    shouldInstall ? "dzx dev" : "pnpm install",
    shouldInstall ? "" : "dzx dev",
  ].filter(Boolean);
  // eslint-disable-next-line no-console
  console.log(`${colorize.gray("next")} ${colorize.cyan(nextSteps.join(" && "))}`);
}
