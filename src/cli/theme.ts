import { colorize } from "./format.js";

/**
 * Render a success-style outro line.
 */
export function outroLine(message: string): string {
  return colorize.green(message);
}
