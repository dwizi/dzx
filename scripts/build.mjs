import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const entryPoints = {
  "cli/dzx": "src/cli/dzx.ts",
  "cli/commands": "src/cli/commands.ts",
  "cli/init": "src/cli/init.ts",
  "cli/run-command": "src/cli/run-command.ts",
  "runtime/index": "src/runtime/index.ts",
  "testing/index": "src/testing/index.ts",
  "core/env": "src/core/env.ts",
  "core/discovery": "src/core/discovery.ts",
  "schema/index": "src/schema/index.ts",
};

const buildOptions = {
  entryPoints,
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  splitting: false,
  sourcemap: false,
  packages: "external",
  external: ["esbuild", "json5", "@clack/prompts", "ajv", "chokidar"],
};

if (watch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log("dzx build watching...");
} else {
  await esbuild.build(buildOptions);
}
