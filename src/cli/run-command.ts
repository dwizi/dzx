import { spawn } from "node:child_process";

/**
 * Run a shell command in a given working directory.
 */
export async function runCommand(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, stdio: "inherit", shell: true });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command}`));
    });
  });
}
