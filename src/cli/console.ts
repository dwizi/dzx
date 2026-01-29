import { getDzxVersion } from "../shared/version.js";
import { colorize, symbols } from "./format.js";

/**
 * Render the CLI banner header.
 */
export function printBanner(command: string, subtitle?: string): void {
  const version = getDzxVersion();
  const tail = subtitle ? ` ${colorize.gray(subtitle)}` : "";
  // eslint-disable-next-line no-console
  console.log(
    `${"\n"}${colorize.blue(symbols.brand)} ${colorize.bold(`dzx v${version}`)} ${colorize.gray(command)}${tail}`,
  );
  // eslint-disable-next-line no-console
  console.log("");
}

/**
 * Print a section heading.
 */
export function printSection(title: string): void {
  // eslint-disable-next-line no-console
  console.log(colorize.bold(title));
}

/**
 * Format a list entry with an optional description.
 */
export function formatListItem(label: string, description?: string): string {
  const detail = description ? `${colorize.gray("—")} ${description}` : "";
  return `${colorize.gray(symbols.dot)} ${colorize.cyan(label)} ${detail}`.trimEnd();
}

/**
 * Print a help block with usage and options.
 */
export function printHelp(
  command: string,
  usage: string,
  options: Array<{ flag: string; description: string }>,
): void {
  printBanner(command);
  // eslint-disable-next-line no-console
  console.log(`${colorize.bold("Usage")} ${colorize.gray(usage)}`);
  if (options.length === 0) return;
  // eslint-disable-next-line no-console
  console.log("");
  printSection("Options");
  const maxFlag = options.reduce((max, item) => Math.max(max, item.flag.length), 0);
  for (const option of options) {
    const left = colorize.cyan(option.flag.padEnd(maxFlag));
    const right = colorize.gray(option.description);
    // eslint-disable-next-line no-console
    console.log(`  ${left} ${right}`);
  }
}

/**
 * Print a aligned key/value summary list.
 */
export function printKeyValueList(items: Array<{ label: string; value: string }>): void {
  if (items.length === 0) return;
  const maxLabel = items.reduce((max, item) => Math.max(max, item.label.length), 0);
  for (const item of items) {
    const padded = item.label.padEnd(maxLabel);
    // eslint-disable-next-line no-console
    console.log(
      `${colorize.gray(symbols.dot)} ${colorize.gray(padded)} : ${colorize.cyan(item.value)}`,
    );
  }
}
