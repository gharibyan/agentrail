import { type CommandRunner, runCommand } from "./cloudflare.js";

export interface InstallProjectDependenciesInput {
  targetDir: string;
  runner?: CommandRunner;
}

export interface InstallProjectDependenciesResult {
  installed: boolean;
  error?: string;
}

export async function installProjectDependencies({
  targetDir,
  runner = runCommand
}: InstallProjectDependenciesInput): Promise<InstallProjectDependenciesResult> {
  const result = await runner("npm", ["install"], { cwd: targetDir });

  if (result.exitCode === 0) {
    return { installed: true };
  }

  return {
    installed: false,
    error: formatInstallError(result)
  };
}

function formatInstallError(result: { stdout: string; stderr: string }): string {
  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  return details ? `Unable to install dependencies:\n${details}` : "Unable to install dependencies.";
}
