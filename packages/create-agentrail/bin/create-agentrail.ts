#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { ensureKvNamespace } from "../src/cloudflare.js";
import { installProjectDependencies } from "../src/install.js";
import { buildProjectFiles, normalizeProjectName } from "../src/scaffold.js";

const args = process.argv.slice(2);
const options = parseArgs(args);
const projectName = normalizeProjectName(options._[0] || "agentrail-site");
const targetDir = resolve(process.cwd(), projectName);
const kvNamespaceId = await resolveKvNamespaceId(options);

const files = buildProjectFiles({
  projectName,
  origin: options.origin,
  route: options.route,
  crawlSchedule: options.schedule,
  storageMode: options.storage || "basic",
  localPackageRoot: fileURLToPath(new URL("../../..", import.meta.url)),
  targetDir,
  kvNamespaceId
});

await mkdir(targetDir, { recursive: true });
for (const [filePath, contents] of Object.entries(files)) {
  const absolutePath = join(targetDir, filePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, contents);
}

const dependencyInstallResult = await resolveDependencyInstall(options, targetDir);

console.log(`AgentRail project created at ${targetDir}`);
console.log("");
console.log("Next steps:");
console.log(`  cd ${projectName}`);
if (!dependencyInstallResult.installed) {
  console.log("  npm install");
}
if (!kvNamespaceId) {
  console.log("  npx wrangler kv namespace create AGENTRAIL_RESOURCES");
  console.log("  paste the namespace id into wrangler.jsonc");
}
console.log("  npm run deploy");

interface ParsedArgs {
  _: string[];
  origin?: string;
  route?: string;
  schedule?: string;
  storage?: string;
  "kv-id"?: string;
  "skip-cloudflare"?: boolean | string;
  "skip-install"?: boolean | string;
  [key: string]: string | boolean | string[] | undefined;
}

function parseArgs(values: string[]): ParsedArgs {
  const parsed: ParsedArgs = { _: [] };
  for (const value of values) {
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }

    const [key, rawValue = ""] = value.slice(2).split("=");
    parsed[key] = rawValue || true;
  }
  return parsed;
}

async function resolveKvNamespaceId(options: ParsedArgs): Promise<string | undefined> {
  if (typeof options["kv-id"] === "string" && options["kv-id"]) {
    return options["kv-id"];
  }

  if (options["skip-cloudflare"]) {
    return undefined;
  }

  try {
    console.log("Checking Cloudflare KV namespace AGENTRAIL_RESOURCES...");
    const namespace = await ensureKvNamespace({ binding: "AGENTRAIL_RESOURCES" });
    console.log(`${namespace.created ? "Created" : "Reusing"} KV namespace AGENTRAIL_RESOURCES (${namespace.id}).`);
    return namespace.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Could not auto-create AGENTRAIL_RESOURCES. The generated project will include manual setup instructions.");
    console.warn(message);
    return undefined;
  }
}

async function resolveDependencyInstall(
  options: ParsedArgs,
  targetDir: string
): Promise<{ installed: boolean }> {
  if (options["skip-install"]) {
    return { installed: false };
  }

  console.log("Installing generated project dependencies...");
  const result = await installProjectDependencies({ targetDir });
  if (result.installed) {
    console.log("Installed generated project dependencies.");
    return { installed: true };
  }

  console.warn(result.error ?? "Unable to install dependencies.");
  console.warn("The generated project is still ready; run npm install inside it before deploying.");
  return { installed: false };
}
