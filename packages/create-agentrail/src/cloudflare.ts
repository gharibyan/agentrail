import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  cwd?: string;
}

export type CommandRunner = (command: string, args: string[], options?: CommandRunnerOptions) => Promise<CommandResult>;

export interface EnsureKvNamespaceInput {
  binding?: string;
  runner?: CommandRunner;
}

export interface EnsureKvNamespaceResult {
  binding: string;
  id: string;
  created: boolean;
}

interface ListedKvNamespace {
  id?: string;
  title?: string;
  name?: string;
  binding?: string;
}

const DEFAULT_KV_BINDING = "AGENTRAIL_RESOURCES";

export async function ensureKvNamespace({
  binding = DEFAULT_KV_BINDING,
  runner = runCommand
}: EnsureKvNamespaceInput = {}): Promise<EnsureKvNamespaceResult> {
  const listResult = await runner("npx", ["wrangler", "kv", "namespace", "list", "--json"]);
  if (listResult.exitCode !== 0) {
    throw new Error(formatCommandError("Unable to list Cloudflare KV namespaces", listResult));
  }

  const existingNamespace = parseKvNamespaceList(listResult.stdout).find((namespace) => {
    return namespace.id && [namespace.title, namespace.name, namespace.binding].includes(binding);
  });

  if (existingNamespace?.id) {
    return {
      binding,
      id: existingNamespace.id,
      created: false
    };
  }

  const createResult = await runner("npx", ["wrangler", "kv", "namespace", "create", binding, "--json"]);
  if (createResult.exitCode !== 0) {
    throw new Error(formatCommandError(`Unable to create Cloudflare KV namespace ${binding}`, createResult));
  }

  const id = parseKvNamespaceCreateId(createResult.stdout);
  if (!id) {
    throw new Error(`Unable to find KV namespace id in Wrangler output: ${createResult.stdout}`);
  }

  return {
    binding,
    id,
    created: true
  };
}

export function runCommand(command: string, args: string[], options: CommandRunnerOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message
      });
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

export function parseKvNamespaceList(stdout: string): ListedKvNamespace[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(isListedKvNamespace);
    }
  } catch {
    return [];
  }

  return [];
}

export function parseKvNamespaceCreateId(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const id = findIdValue(parsed);
    if (id) {
      return id;
    }
  } catch {
    // Wrangler versions have not all used identical JSON/text output.
  }

  return (
    stdout.match(/\bid\s*=\s*"([^"]+)"/i)?.[1] ??
    stdout.match(/\bid\s*:\s*([A-Za-z0-9_-]+)/i)?.[1] ??
    stdout.match(/"id"\s*:\s*"([^"]+)"/i)?.[1] ??
    null
  );
}

function findIdValue(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if ("id" in value && typeof value.id === "string") {
    return value.id;
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const id = findIdValue(item);
        if (id) {
          return id;
        }
      }
      continue;
    }

    const id = findIdValue(child);
    if (id) {
      return id;
    }
  }

  return null;
}

function isListedKvNamespace(value: unknown): value is ListedKvNamespace {
  return Boolean(value && typeof value === "object" && "id" in value);
}

function formatCommandError(message: string, result: CommandResult): string {
  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  return details ? `${message}:\n${details}` : message;
}
