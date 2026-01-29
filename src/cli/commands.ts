import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build as esbuild } from "esbuild";
import { discoverPrompts, discoverResources, discoverTools } from "../core/discovery.js";
import { loadEnvFiles } from "../core/env.js";
import { copyDir, ensureDir } from "../core/fs.js";
import {
  existsWithinRepo,
  loadManifest,
  normalizeManifest,
  validateManifest,
} from "../core/manifest.js";
import { getDzxVersion } from "../shared/version.js";
import { parseArgs } from "./args.js";
import {
  formatListItem,
  printBanner,
  printHelp,
  printKeyValueList,
  printSection,
} from "./console.js";
import { colorize, symbols } from "./format.js";
import { createSpinner } from "./spinner.js";

type JsonSchemaProvider = {
  toJSONSchema: () => unknown;
};

/**
 * Check whether a schema exposes a toJSONSchema hook.
 */
function hasToJSONSchema(schema: unknown): schema is JsonSchemaProvider {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "toJSONSchema" in schema &&
    typeof (schema as JsonSchemaProvider).toJSONSchema === "function"
  );
}

/**
 * Normalize schemas that expose a toJSONSchema hook.
 */
function normalizeSchema(schema: unknown): unknown {
  if (hasToJSONSchema(schema)) {
    return schema.toJSONSchema();
  }
  return schema;
}

/**
 * Check if a value looks like a NodeJS error object.
 */
function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return typeof value === "object" && value !== null && "code" in value;
}

/**
 * Normalize env overrides to string values.
 */
function normalizeEnvOverrides(env: Record<string, unknown> | undefined): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  if (!env) return output;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    output[key] = String(value);
  }
  return output;
}

/**
 * Resolve the working directory from CLI arguments.
 */
function resolveCwd(arg: string | boolean | undefined): string {
  if (typeof arg === "string") return path.resolve(process.cwd(), arg);
  return process.cwd();
}

/**
 * Resolve output directory paths and relative labels.
 */
function resolveOutDir(cwd: string, outDir: string): { outPath: string; outDirRel: string } {
  const outPath = path.isAbsolute(outDir) ? outDir : path.resolve(cwd, outDir);
  const relative = path.relative(cwd, outPath) || ".";
  const outDirRel = relative.split(path.sep).join(path.posix.sep);
  return { outPath, outDirRel };
}

/**
 * Join a manifest base path with a subpath using POSIX separators.
 */
function joinManifestPath(base: string, subpath: string): string {
  if (!base || base === ".") return subpath;
  return path.posix.join(base, subpath);
}

/**
 * Check if tsx is resolvable from the current workspace.
 */
function hasTsx(cwd: string): boolean {
  try {
    const require = createRequire(path.join(cwd, "package.json"));
    require.resolve("tsx");
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a path to POSIX separators.
 */
function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

/**
 * Compute a relative file path to a base directory (POSIX).
 */
function relativeToDir(dirAbs: string, fileAbs: string): string {
  return toPosix(path.relative(dirAbs, fileAbs));
}

/**
 * Create a file watcher with polling fallback.
 */
async function createWatcher(
  paths: string[],
  onChange: (filename?: string) => void,
): Promise<() => void> {
  const watchTargets = paths.filter((candidate) => fs.existsSync(candidate));
  if (watchTargets.length === 0) return () => {};

  const { watch } = await import("chokidar");
  let timeout: NodeJS.Timeout | null = null;
  let watcher = watch(watchTargets, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    usePolling: process.env.DZX_POLLING === "1",
    ignored: ["**/node_modules/**", "**/.git/**"],
  });

  /**
   * Debounce file change events before restarting.
   */
  const handleChange = (filePath?: string) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => onChange(filePath), 150);
  };

  watcher.on("add", handleChange);
  watcher.on("change", handleChange);
  watcher.on("unlink", handleChange);
  watcher.on("error", (err: unknown) => {
    if (isErrnoException(err) && (err.code === "EMFILE" || err.code === "ENOSPC")) {
      // fallback to polling when file descriptors are exhausted
      watcher.close().catch(() => {});
      watcher = watch(watchTargets, {
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
        usePolling: true,
        ignored: ["**/node_modules/**", "**/.git/**"],
      });
      // eslint-disable-next-line no-console
      console.error(
        `${colorize.yellow("warn")} ${colorize.gray("file watching degraded to polling")}`,
      );
      watcher.on("add", handleChange);
      watcher.on("change", handleChange);
      watcher.on("unlink", handleChange);
    }
  });

  return () => {
    watcher.close().catch(() => {});
  };
}

/**
 * Run a shell command with explicit env in a working directory.
 */
async function runCommandWithEnv(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, stdio: "inherit", shell: true });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command}`));
    });
  });
}

/**
 * Run the inspect command.
 */
export async function runInspect(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cwd = resolveCwd(args.cwd as string | undefined);
  const config = (args.config as string | undefined) ?? "mcp.json";
  const format = args.json ? "json" : ((args.format as string | undefined) ?? "table");
  if (args.help || args.h) {
    printHelp("inspect", "dzx inspect [options]", [
      { flag: "--config <path>", description: "manifest path (default: mcp.json)" },
      { flag: "--cwd <path>", description: "working directory (default: .)" },
      { flag: "--format <table|json>", description: "output format (default: table)" },
      { flag: "--json", description: "shorthand for --format json" },
    ]);
    return;
  }

  const { manifest } = loadManifest(cwd, config);
  const normalized = normalizeManifest(manifest);

  const warnings: string[] = [];
  const tools = await discoverTools(cwd, normalized.toolsDir ?? "tools", {
    onWarn: (message) => warnings.push(message),
  });
  const resources = discoverResources(cwd, normalized.resourcesDir ?? "resources");
  const prompts = discoverPrompts(cwd, normalized.promptsDir ?? "prompts");

  if (format === "json") {
    if (warnings.length > 0) {
      for (const warning of warnings) {
        // eslint-disable-next-line no-console
        console.error(`${colorize.yellow("warn")} ${colorize.gray(warning)}`);
      }
    }
    const normalizedTools = tools.map((t) => ({
      ...t,
      inputSchema: normalizeSchema(t.inputSchema),
      outputSchema: normalizeSchema(t.outputSchema),
    }));
    const payload = { tools: normalizedTools, resources, prompts };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printBanner("inspect");
  if (warnings.length > 0) {
    for (const warning of warnings) {
      // eslint-disable-next-line no-console
      console.log(`${colorize.yellow("warn")} ${colorize.gray(warning)}`);
    }
    // eslint-disable-next-line no-console
    console.log("");
  }
  printSection("Tools");
  if (tools.length === 0) {
    // eslint-disable-next-line no-console
    console.log("  (none)");
  } else {
    for (const tool of tools) {
      const inputSource = tool.inputSchemaSource ?? "unknown";
      const outputSource = tool.outputSchemaSource ?? "unknown";
      const schemaInfo = `schema in:${inputSource} out:${outputSource}`;
      const description = tool.description
        ? `${tool.description} (${schemaInfo})`
        : `(${schemaInfo})`;
      // eslint-disable-next-line no-console
      console.log(`  ${formatListItem(tool.name, description)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log("");
  printSection("Resources");
  if (resources.length === 0) {
    // eslint-disable-next-line no-console
    console.log("  (none)");
  } else {
    for (const resource of resources) {
      // eslint-disable-next-line no-console
      console.log(`  ${formatListItem(resource.name, resource.description)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log("");
  printSection("Prompts");
  if (prompts.length === 0) {
    // eslint-disable-next-line no-console
    console.log("  (none)");
  } else {
    for (const prompt of prompts) {
      // eslint-disable-next-line no-console
      console.log(`  ${formatListItem(prompt.name, prompt.description)}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log("");
  printSection("Summary");
  printKeyValueList([
    { label: "tools", value: String(tools.length) },
    { label: "resources", value: String(resources.length) },
    { label: "prompts", value: String(prompts.length) },
  ]);
}

/**
 * Run the validate command.
 */
export async function runValidate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cwd = resolveCwd(args.cwd as string | undefined);
  const config = (args.config as string | undefined) ?? "mcp.json";
  const strict = Boolean(args.strict);
  if (args.help || args.h) {
    printHelp("validate", "dzx validate [options]", [
      { flag: "--config <path>", description: "manifest path (default: mcp.json)" },
      { flag: "--cwd <path>", description: "working directory (default: .)" },
      { flag: "--strict", description: "fail if optional dirs are missing" },
    ]);
    return;
  }

  const { manifest } = loadManifest(cwd, config);
  const normalized = normalizeManifest(manifest);

  const errors = validateManifest(normalized);
  const entryOk = normalized.entry ? existsWithinRepo(cwd, normalized.entry) : false;

  printBanner("validate");

  if (!entryOk) {
    errors.push(`entry file not found: ${normalized.entry}`);
  }

  const toolsDir = normalized.toolsDir ?? "tools";
  const resourcesDir = normalized.resourcesDir ?? "resources";
  const promptsDir = normalized.promptsDir ?? "prompts";

  const dirsToCheck = [
    { label: "Tools", dir: toolsDir },
    { label: "Resources", dir: resourcesDir },
    { label: "Prompts", dir: promptsDir },
  ];

  for (const item of dirsToCheck) {
    if (!existsWithinRepo(cwd, item.dir)) {
      if (strict) {
        errors.push(`${item.label} directory not found: ${item.dir}`);
      }
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      // eslint-disable-next-line no-console
      console.log(`${colorize.red("ERR")} ${err}`);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`${colorize.green(symbols.check)} ${colorize.bold("Manifest valid")}`);
  const toolValue = existsWithinRepo(cwd, toolsDir) ? toolsDir : `${toolsDir} (missing)`;
  const resourceValue = existsWithinRepo(cwd, resourcesDir)
    ? resourcesDir
    : `${resourcesDir} (missing)`;
  const promptValue = existsWithinRepo(cwd, promptsDir) ? promptsDir : `${promptsDir} (missing)`;
  printKeyValueList([
    { label: "tools", value: toolValue },
    { label: "resources", value: resourceValue },
    { label: "prompts", value: promptValue },
  ]);
}

/**
 * Run the build command.
 */
export async function runBuild(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cwd = resolveCwd(args.cwd as string | undefined);
  const config = (args.config as string | undefined) ?? "mcp.json";
  const outDirArg = args["out-dir"] as string | undefined;
  const splitTools = Boolean(args["split-tools"]);
  const bundleTools = Boolean(args.bundle);
  const sourcemap = Boolean(args.sourcemap);
  const minify = Boolean(args.minify);
  const format = (args.format as string | undefined) ?? "esm";
  if (args.help || args.h) {
    printHelp("build", "dzx build [options]", [
      { flag: "--config <path>", description: "manifest path (default: mcp.json)" },
      { flag: "--cwd <path>", description: "working directory (default: .)" },
      { flag: "--out-dir <path>", description: "output directory (default: dist)" },
      { flag: "--split-tools", description: "emit one bundled file per tool" },
      { flag: "--bundle", description: "bundle tools without splitting" },
      { flag: "--format <esm|cjs>", description: "output module format (default: esm)" },
      { flag: "--sourcemap", description: "emit sourcemaps" },
      { flag: "--minify", description: "minify output" },
    ]);
    return;
  }
  const validFormat = format === "esm" || format === "cjs";
  if (!validFormat) {
    throw new Error(`Unsupported format: ${format}. Use "esm" or "cjs".`);
  }

  const spinner = createSpinner(process.stdout.isTTY);
  printBanner("build");
  const warningSet = new Set<string>();
  /**
   * Emit a de-duplicated warning line during build.
   */
  const logWarning = (message: string) => {
    if (warningSet.has(message)) return;
    warningSet.add(message);
    if (spinner.isEnabled) spinner.pause();
    // eslint-disable-next-line no-console
    console.log(`${colorize.yellow("warn")} ${colorize.gray(message)}`);
    if (spinner.isEnabled) spinner.resume();
  };
  const stepLabels = [
    "Loading manifest",
    "Preparing output",
    "Running build command",
    "Building tools",
    "Copying resources",
    "Copying prompts",
    "Generating manifest",
  ];
  const stepLabelWidth = stepLabels.reduce((max, label) => Math.max(max, label.length), 0);
  /**
   * Print a completed build step with elapsed time.
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
  const stepTimes: Array<{ label: string; ms: number }> = [];
  let spinnerStarted = false;
  let stepStart = Date.now();
  let lastStep = "";
  /**
   * Advance the build spinner and record timing for the previous step.
   */
  const step = (message: string) => {
    const now = Date.now();
    if (lastStep) {
      const ms = now - stepStart;
      stepTimes.push({ label: lastStep, ms });
      logStep(lastStep, ms);
      if (spinnerStarted) {
        spinner.stop();
        spinnerStarted = false;
      }
    }
    lastStep = message;
    stepStart = now;
    if (!spinner.isEnabled) return;
    spinner.start(message);
    spinnerStarted = true;
  };

  try {
    if (lastStep && spinner.isEnabled) {
      spinner.stop();
    }
    step("Loading manifest");
    const { manifest } = loadManifest(cwd, config);
    const normalized = normalizeManifest(manifest);
    const manifestErrors = validateManifest(normalized);
    if (normalized.entry && !existsWithinRepo(cwd, normalized.entry)) {
      manifestErrors.push(`entry file not found: ${normalized.entry}`);
    }
    if (manifestErrors.length > 0) {
      spinner.stop();
      for (const error of manifestErrors) {
        // eslint-disable-next-line no-console
        console.log(`${colorize.red("ERR")} ${error}`);
      }
      process.exit(1);
    }
    const outDir = outDirArg ?? manifest.build?.output ?? "dist";

    step("Preparing output");
    const { outPath, outDirRel } = resolveOutDir(cwd, outDir);
    ensureDir(outPath);

    const toolsDir = normalized.toolsDir ?? "tools";
    const resourcesDir = normalized.resourcesDir ?? "resources";
    const promptsDir = normalized.promptsDir ?? "prompts";
    const toolsDirAbs = path.resolve(cwd, toolsDir);
    const resourcesDirAbs = path.resolve(cwd, resourcesDir);
    const promptsDirAbs = path.resolve(cwd, promptsDir);

    if (manifest.build?.command) {
      step("Running build command");
      if (spinner.isEnabled) spinner.pause();
      await runCommandWithEnv(manifest.build.command, cwd, {
        ...process.env,
        ...normalizeEnvOverrides(manifest.build.env),
      });
    }

    step("Building tools");
    if (existsWithinRepo(cwd, toolsDir)) {
      if (splitTools || bundleTools) {
        const discovered = await discoverTools(cwd, toolsDir, {
          onWarn: logWarning,
          failOnInvalid: true,
        });
        const toolFiles = Array.from(
          new Set(discovered.map((tool) => path.resolve(cwd, tool.file))),
        ).sort((a, b) => a.localeCompare(b));
        if (toolFiles.length > 0) {
          await esbuild({
            entryPoints: toolFiles,
            outdir: path.join(outPath, "tools"),
            outbase: toolsDirAbs,
            bundle: true,
            platform: "node",
            format,
            target: "node24",
            sourcemap,
            minify,
            logLevel: "silent",
          });
        }
      } else {
        copyDir(toolsDirAbs, path.join(outPath, "tools"));
      }
    }
    step("Copying resources");
    if (existsWithinRepo(cwd, resourcesDir)) {
      copyDir(resourcesDirAbs, path.join(outPath, "resources"));
    }
    step("Copying prompts");
    if (existsWithinRepo(cwd, promptsDir)) {
      copyDir(promptsDirAbs, path.join(outPath, "prompts"));
    }

    step("Generating manifest");
    const discoveredTools = await discoverTools(cwd, toolsDir, {
      onWarn: logWarning,
      failOnInvalid: true,
    });
    const tools = discoveredTools.map((tool) => {
      const toolFileAbs = path.resolve(cwd, tool.file);
      const relativePath = relativeToDir(toolsDirAbs, toolFileAbs);
      const outputFile = splitTools
        ? relativePath.replace(path.extname(relativePath), ".js")
        : relativePath;
      return {
        name: tool.name,
        description: tool.description ?? "",
        file: joinManifestPath(outDirRel, path.posix.join("tools", outputFile)),
        inputSchema: normalizeSchema(tool.inputSchema),
        outputSchema: normalizeSchema(tool.outputSchema),
        format: splitTools || bundleTools ? format : "source",
      };
    });

    const resources = discoverResources(cwd, resourcesDir).map((resource) => {
      const resourceFileAbs = path.resolve(cwd, resource.file);
      const relativePath = relativeToDir(resourcesDirAbs, resourceFileAbs);
      return {
        name: resource.name,
        description: resource.description,
        file: joinManifestPath(outDirRel, path.posix.join("resources", relativePath)),
        mediaType: resource.mediaType ?? "text/markdown",
      };
    });

    const prompts = discoverPrompts(cwd, promptsDir).map((prompt) => {
      const promptFileAbs = path.resolve(cwd, prompt.file);
      const relativePath = relativeToDir(promptsDirAbs, promptFileAbs);
      return {
        name: prompt.name,
        description: prompt.description,
        file: joinManifestPath(outDirRel, path.posix.join("prompts", relativePath)),
        inputs: prompt.inputs ?? [],
      };
    });

    tools.sort((a, b) => a.name.localeCompare(b.name));
    resources.sort((a, b) => a.name.localeCompare(b.name));
    prompts.sort((a, b) => a.name.localeCompare(b.name));

    const manifestPayload = {
      manifestVersion: "1",
      app: {
        name: normalized.name,
        version: normalized.version,
        entry: normalized.entry,
      },
      runtime: normalized.runtime,
      permissions: normalized.permissions,
      toolFormat: splitTools || bundleTools ? format : "source",
      tools,
      resources,
      prompts,
    };

    const manifestPath = path.join(outPath, "tool-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifestPayload, null, 2));

    const outputRel = path.relative(cwd, outPath) || ".";
    const manifestRel = path.relative(cwd, manifestPath) || "tool-manifest.json";
    const toolFormat = splitTools || bundleTools ? format : "source";
    if (lastStep) {
      const ms = Date.now() - stepStart;
      stepTimes.push({ label: lastStep, ms });
      logStep(lastStep, ms);
    }
    if (spinnerStarted) {
      spinner.stop();
      spinnerStarted = false;
    }

    const items = [
      { label: "output", value: outputRel },
      { label: "manifest", value: manifestRel },
      { label: "tools", value: `${tools.length} (${toolFormat})` },
      { label: "resources", value: String(resources.length) },
      { label: "prompts", value: String(prompts.length) },
    ];

    const stepLabelMap: Record<string, string> = {
      Building: "start",
      "Loading manifest": "manifest",
      "Preparing output": "prepare",
      "Running build command": "build",
      "Building tools": "tools",
      "Copying resources": "resources",
      "Copying prompts": "prompts",
      "Generating manifest": "manifest",
    };
    const timingParts = stepTimes.map((item) => ({
      label: stepLabelMap[item.label] ?? item.label,
      ms: item.ms,
    }));
    const totalMs = timingParts.reduce((sum, item) => sum + item.ms, 0);
    const timingLine = `${totalMs}ms`;

    const maxLabel = items.reduce((max, item) => Math.max(max, item.label.length), 0);
    /**
     * Format a single build summary line.
     */
    const formatLine = (label: string, value: string) => {
      const padded = label.padEnd(maxLabel);
      const left = colorize.gray(padded);
      const right = colorize.cyan(value);
      return `${colorize.gray(symbols.dot)} ${left}: ${right}`;
    };

    const header = `${colorize.green(symbols.check)} ${colorize.bold("Build complete")}`;
    const lines = items.map((item) => formatLine(item.label, item.value));
    if (timingLine) {
      lines.push(
        `${colorize.gray(symbols.dot)} ${colorize.gray("total".padEnd(maxLabel))}: ${colorize.dim(timingLine)}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(["", header, "", ...lines.map((line) => `  ${line}`)].join("\n"));
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

/**
 * Run the dev server with hot reload.
 */
export async function runDev(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cwd = resolveCwd(args.cwd as string | undefined);
  const config = (args.config as string | undefined) ?? "mcp.json";
  const watchEnabled = !args["no-watch"];
  if (args.poll) {
    process.env.DZX_POLLING = "1";
  }
  const port = args.port ? Number(args.port) : undefined;
  const logLevel = args.quiet ? "quiet" : args.verbose ? "verbose" : "info";
  if (args.help || args.h) {
    printHelp("dev", "dzx dev [options]", [
      { flag: "--config <path>", description: "manifest path (default: mcp.json)" },
      { flag: "--cwd <path>", description: "working directory (default: .)" },
      { flag: "--port <number>", description: "server port (default: 3333)" },
      { flag: "--no-watch", description: "disable file watching" },
      { flag: "--poll", description: "use polling for file watching" },
      { flag: "--quiet", description: "minimal output" },
      { flag: "--verbose", description: "debug output" },
    ]);
    return;
  }

  const { manifest } = loadManifest(cwd, config);
  const normalized = normalizeManifest(manifest);
  const version = getDzxVersion();

  const entryPath = path.resolve(cwd, normalized.entry);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }
  const entryExt = path.extname(entryPath);
  const usesTs = entryExt === ".ts" || entryExt === ".tsx";
  if (normalized.runtime === "node" && usesTs && !hasTsx(cwd)) {
    // eslint-disable-next-line no-console
    console.error(
      `${colorize.red("ERR")} tsx not found. Install it or use a compiled JS entrypoint.`,
    );
    // eslint-disable-next-line no-console
    console.error(colorize.gray("Hint: pnpm add -D tsx"));
    process.exit(1);
  }

  const toolsDir = normalized.toolsDir ?? "tools";
  const resourcesDir = normalized.resourcesDir ?? "resources";
  const promptsDir = normalized.promptsDir ?? "prompts";

  let child: ReturnType<typeof spawn> | null = null;
  let closeWatcher: (() => void) | null = null;
  let started = false;
  let lastChange: string | undefined;

  /**
   * Log a restart banner with the last change filename.
   */
  const logRestart = () => {
    if (!started) return;
    const detail = lastChange ? ` ${colorize.dim(lastChange)}` : "";
    lastChange = undefined;
    // eslint-disable-next-line no-console
    console.log(
      `${colorize.cyan(symbols.step)} ${colorize.gray("Restarting dev server")}${detail}`,
    );
  };

  /**
   * Start or restart the dev runtime process.
   */
  const start = () => {
    logRestart();
    if (child) {
      try {
        if (child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        child.kill("SIGTERM");
      }
    }

    const devMode = started ? "restart" : "start";
    const envMode = process.env.DZX_ENV ?? process.env.NODE_ENV ?? "development";
    const fileEnv = loadEnvFiles(cwd, envMode);
    const envBase = {
      ...fileEnv,
      ...process.env,
      DZX_DEV: "1",
      DZX_VERSION: version,
      DZX_NAME: normalized.name,
      DZX_DEV_MODE: devMode,
      DZX_DEV_BANNER: "0",
      DZX_LOG_LEVEL: logLevel,
    };
    if (normalized.runtime === "deno") {
      const denoArgs = ["run"];
      if (watchEnabled) denoArgs.push("--watch");
      denoArgs.push("--allow-read");
      if (normalized.permissions?.network) denoArgs.push("--allow-net");
      denoArgs.push(entryPath);
      const env = port ? { ...envBase, PORT: String(port) } : envBase;
      child = spawn("deno", denoArgs, { stdio: "inherit", cwd, env, detached: true });
      child.on("error", (err) => {
        // eslint-disable-next-line no-console
        console.error(`Failed to start deno: ${err.message}`);
        process.exit(1);
      });
      return;
    }

    const cmd = "node";
    const nodeArgs = usesTs
      ? ["--import", "tsx", entryPath]
      : [watchEnabled ? "--watch" : "", entryPath].filter(Boolean);
    const env = port ? { ...envBase, PORT: String(port) } : envBase;
    child = spawn(cmd, nodeArgs, { stdio: "inherit", cwd, env, detached: true });
    child.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error(`Failed to start ${cmd}: ${err.message}`);
      if (usesTs) {
        // eslint-disable-next-line no-console
        console.error("Install tsx or use a compiled JS entrypoint.");
      }
      process.exit(1);
    });

    if (!started) {
      started = true;
      printBanner("dev");
      const infoItems = [
        { label: "name", value: normalized.name },
        { label: "runtime", value: normalized.runtime },
        { label: "entry", value: path.relative(cwd, entryPath) || normalized.entry },
      ];
      if (watchEnabled) {
        infoItems.push({ label: "watch", value: "tools, resources, prompts" });
      }
      const maxLabel = infoItems.reduce((max, item) => Math.max(max, item.label.length), 0);
      /**
       * Format a dev info line.
       */
      const formatLine = (label: string, value: string) =>
        `${colorize.gray(label.padEnd(maxLabel))} : ${colorize.cyan(value)}`;
      for (const item of infoItems) {
        // eslint-disable-next-line no-console
        console.log(`  ${formatLine(item.label, item.value)}`);
      }
      // eslint-disable-next-line no-console
      console.log("");
    }
  };

  start();

  if (normalized.runtime === "node" && watchEnabled) {
    const envMode = process.env.DZX_ENV ?? process.env.NODE_ENV ?? "development";
    const watchPaths = [
      entryPath,
      path.resolve(cwd, config),
      path.resolve(cwd, toolsDir),
      path.resolve(cwd, resourcesDir),
      path.resolve(cwd, promptsDir),
      path.resolve(cwd, ".env"),
      path.resolve(cwd, ".env.local"),
      path.resolve(cwd, `.env.${envMode}`),
      path.resolve(cwd, `.env.${envMode}.local`),
    ];
    closeWatcher = await createWatcher(watchPaths, (filename) => {
      lastChange = filename ? `change: ${filename}` : "change detected";
      start();
    });
  }

  /**
   * Gracefully stop watchers and child processes on exit.
   */
  const shutdown = () => {
    if (closeWatcher) closeWatcher();
    if (child) {
      try {
        if (child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        child.kill("SIGTERM");
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
