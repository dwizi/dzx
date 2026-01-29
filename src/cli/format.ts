const useColor = Boolean(process.stdout.isTTY);

/**
 * Create an ANSI color formatter for TTY output.
 */
function color(code: string) {
  return (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
}

export const colorize = {
  green: color("32"),
  cyan: color("36"),
  blue: color("34"),
  yellow: color("33"),
  red: color("31"),
  gray: color("90"),
  bold: color("1"),
  dim: color("2"),
};

export const symbols = {
  check: useColor ? "✔" : "OK",
  dot: "•",
  step: useColor ? "●" : "*",
  brand: useColor ? "▲" : ">",
};
