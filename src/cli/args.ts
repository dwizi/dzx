export type ParsedArgs = {
  positional: string[];
  [key: string]: string | boolean | undefined | string[];
};

/**
 * Parse CLI argv into a simple key/value map.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args.positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}
