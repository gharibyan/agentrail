import { join, relative } from "node:path";

export interface BuildProjectFilesConfig {
  projectName?: string;
  origin?: string;
  route?: string;
  crawlSchedule?: string;
  storageMode?: "basic" | "production" | string;
  localPackageRoot?: string;
  targetDir?: string;
  kvNamespaceId?: string;
}

export type ProjectFiles = Record<string, string>;

interface ResolvedScaffoldConfig {
  projectName: string;
  origin: string;
  route: string;
  crawlSchedule: string;
  storageMode: string;
  kvNamespaceId?: string;
}

type PackageDependencies = Record<string, string>;

export function normalizeProjectName(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "agentrail-site";
}

export function buildProjectFiles(config: BuildProjectFilesConfig = {}): ProjectFiles {
  const projectName = normalizeProjectName(config.projectName);
  const origin = config.origin || "https://example.com";
  const route = config.route || "example.com/*";
  const crawlSchedule = config.crawlSchedule || "0 */6 * * *";
  const storageMode = config.storageMode || "basic";
  const dependencies = buildDependencies(config.localPackageRoot, config.targetDir);
  const kvNamespaceId = config.kvNamespaceId;
  const resolvedConfig = { projectName, origin, route, crawlSchedule, storageMode, kvNamespaceId };

  return {
    "package.json": JSON.stringify(
      {
        name: projectName,
        version: "0.1.0",
        private: true,
        type: "module",
        engines: {
          node: ">=22"
        },
        scripts: {
          dev: "wrangler dev --test-scheduled",
          deploy: "wrangler deploy",
          "kv:drop": "node scripts/agentrail-kv.mjs drop",
          "kv:clear": "node scripts/agentrail-kv.mjs clear",
          tail: "wrangler tail",
          typecheck: "tsc --noEmit"
        },
        dependencies,
        devDependencies: {
          typescript: "^5.5.0",
          wrangler: "^4.97.0"
        }
      },
      null,
      2
    ) + "\n",
    "wrangler.jsonc": buildWranglerConfig(resolvedConfig),
    "src/index.ts": buildWorkerEntrypoint(),
    "scripts/agentrail-kv.mjs": buildKvHelper(),
    "tsconfig.json": buildTsconfig(),
    "README.md": buildReadme(resolvedConfig)
  };
}

function buildDependencies(localPackageRoot?: string, targetDir?: string): PackageDependencies {
  if (!localPackageRoot) {
    return {
      "@agentrail/worker": "^0.1.0"
    };
  }

  const root = String(localPackageRoot).replace(/\/+$/g, "");
  return {
    "@agentrail/worker": localPackageReference(root, targetDir, "packages/worker"),
    "@agentrail/runtime": localPackageReference(root, targetDir, "packages/runtime"),
    "@agentrail/bot-detector": localPackageReference(root, targetDir, "packages/bot-detector"),
    "@agentrail/crawler": localPackageReference(root, targetDir, "packages/crawler"),
    "@agentrail/markdown-extractor": localPackageReference(root, targetDir, "packages/markdown-extractor")
  };
}

function localPackageReference(localPackageRoot: string, targetDir: string | undefined, packagePath: string): string {
  const absolutePackagePath = join(localPackageRoot, packagePath);
  if (!targetDir) {
    return `file:${absolutePackagePath}`;
  }

  let packageReference = relative(targetDir, absolutePackagePath).replace(/\\/g, "/");
  if (!packageReference.startsWith(".")) {
    packageReference = `./${packageReference}`;
  }

  return `file:${packageReference}`;
}

function buildWranglerConfig({
  projectName,
  origin,
  route,
  crawlSchedule,
  storageMode,
  kvNamespaceId
}: ResolvedScaffoldConfig): string {
  const config = {
    name: projectName,
    main: "src/index.ts",
    compatibility_date: "2026-06-03",
    observability: {
      enabled: false,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        head_sampling_rate: 1,
        persist: true,
        invocation_logs: true
      },
      traces: {
        enabled: false,
        persist: true,
        head_sampling_rate: 1
      }
    },
    routes: [{ pattern: route, custom_domain: false }],
    vars: {
      AGENTRAIL_ORIGIN: origin,
      AGENTRAIL_SITEMAP_URL: `${origin.replace(/\/$/, "")}/sitemap.xml`,
      AGENTRAIL_MAX_PAGES_PER_RUN: "500",
      AGENTRAIL_STALE_WINDOW_HOURS: "168",
      AGENTRAIL_STORAGE_MODE: storageMode
    },
    triggers: {
      crons: [crawlSchedule]
    },
    kv_namespaces: [
      {
        binding: "AGENTRAIL_RESOURCES",
        id: kvNamespaceId ?? "replace-with-agentrail-resources-kv-id"
      }
    ]
  };

  return `${JSON.stringify(config, null, 2)}\n`;
}

function buildWorkerEntrypoint(): string {
  return `import agentrail, { type AgentRailEnv, type QueueBatch } from "@agentrail/worker";

export default {
  fetch(request: Request, env: AgentRailEnv, ctx: Record<string, unknown>) {
    if (!env.AGENTRAIL_ORIGIN) {
      console.warn("AGENTRAIL_ORIGIN is not configured.");
    }
    return agentrail.fetch(request, env, ctx);
  },
  scheduled(controller: unknown, env: AgentRailEnv, ctx: Record<string, unknown>) {
    return agentrail.scheduled(controller, env, ctx);
  },
  queue(batch: QueueBatch, env: AgentRailEnv) {
    return agentrail.queue(batch, env);
  }
};
`;
}

function buildTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022", "DOM", "WebWorker"],
        strict: true,
        noEmit: true,
        skipLibCheck: true
      },
      include: ["src/**/*.ts"]
    },
    null,
    2
  )}\n`;
}

function buildKvHelper(): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BINDING = "AGENTRAIL_RESOURCES";
const PAGE_PREFIX = "page:";

const [, , command, ...args] = process.argv;
const options = new Set(args);

if (command === "drop") {
  const [value] = args;
  if (!value) {
    usage("Missing URL or AgentRail KV key.");
  }
  const key = resourceKeyForUrl(value);
  console.log(\`Deleting AgentRail KV key: \${key}\`);
  runCommand("wrangler", ["kv", "key", "delete", key, "--binding", BINDING, "--remote"]);
} else if (command === "clear") {
  if (!options.has("--yes")) {
    usage("Refusing to clear remote Cloudflare KV without --yes.");
  }
  clearAgentRailKeys(readOption(args, "--prefix") || PAGE_PREFIX);
} else {
  usage("Unknown command.");
}

function resourceKeyForUrl(input) {
  if (input.startsWith(PAGE_PREFIX)) {
    return input;
  }
  const parsed = new URL(input);
  parsed.hash = "";
  parsed.search = "";
  return \`\${PAGE_PREFIX}\${parsed.toString()}\`;
}

function clearAgentRailKeys(prefix) {
  const stdout = runCommand("wrangler", ["kv", "key", "list", "--binding", BINDING, "--prefix", prefix, "--remote"], {
    capture: true
  });
  const keys = JSON.parse(stdout)
    .map((item) => typeof item === "string" ? item : item?.name)
    .filter(Boolean);

  if (keys.length === 0) {
    console.log(\`No AgentRail KV keys found with prefix "\${prefix}".\`);
    return;
  }

  const directory = mkdtempSync(join(tmpdir(), "agentrail-kv-"));
  const filename = join(directory, "keys.json");
  writeFileSync(filename, JSON.stringify(keys, null, 2));

  try {
    console.log(\`Deleting \${keys.length} AgentRail KV key(s) with prefix "\${prefix}".\`);
    runCommand("wrangler", ["kv", "bulk", "delete", filename, "--binding", BINDING, "--remote", "--force"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function readOption(values, name) {
  const index = values.indexOf(name);
  if (index === -1) {
    return "";
  }
  return values[index + 1] || "";
}

function runCommand(binary, args, options = {}) {
  const result = spawnSync("npx", [binary, ...args], {
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8"
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout || "";
}

function usage(message) {
  console.error(message);
  console.error("");
  console.error("Usage:");
  console.error("  npm run kv:drop -- https://example.com/features");
  console.error("  npm run kv:drop -- page:https://example.com/features");
  console.error("  npm run kv:clear -- --yes");
  console.error("  npm run kv:clear -- --yes --prefix page:https://example.com/features");
  process.exit(1);
}
`;
}

function buildReadme({ projectName, origin, route, crawlSchedule, storageMode, kvNamespaceId }: ResolvedScaffoldConfig): string {
  const kvSetup = kvNamespaceId
    ? `KV namespace configured automatically:

\`\`\`txt
AGENTRAIL_RESOURCES -> ${kvNamespaceId}
\`\`\``
    : `Create the KV namespace and paste the returned id into \`wrangler.jsonc\`:

\`\`\`bash
npx wrangler kv namespace create AGENTRAIL_RESOURCES
\`\`\``;

  return `# ${projectName}

Generated by AgentRail.

## Settings

- Origin: ${origin}
- Route: ${route}
- Crawl schedule: ${crawlSchedule}
- Storage mode: ${storageMode}

## Cloudflare setup

${kvSetup}

AgentRail uses a Cloudflare Cron Trigger for background crawling. If this is the first Worker on the Cloudflare account, open the Cloudflare dashboard and visit Workers & Pages once before deploying. Cloudflare creates the required workers.dev subdomain there. If deploy fails with code 10063, do that dashboard step and rerun deploy.

\`create-agentrail\` installs dependencies automatically by default. If this project was generated with \`--skip-install\` or the install failed, run:

\`\`\`bash
npm install
\`\`\`

Then deploy:

\`\`\`bash
npm run deploy
\`\`\`

For local development, run:

\`\`\`bash
npm run dev
\`\`\`

The dev server starts Wrangler with scheduled-test support. Trigger the background crawler locally with:

\`\`\`bash
curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"
\`\`\`

Deployed projects persist Worker logs to Cloudflare observability by default. Use \`npm run tail\` for a live log stream while testing a deployment.

## Cloudflare KV maintenance

Drop one generated Markdown resource from remote Cloudflare KV by URL:

\`\`\`bash
npm run kv:drop -- ${origin.replace(/\/$/, "")}/features
\`\`\`

The script converts the URL to AgentRail's KV key format, for example \`page:${origin.replace(/\/$/, "")}/features\`, and runs Wrangler against the \`AGENTRAIL_RESOURCES\` binding.

Clear all AgentRail page resources from remote Cloudflare KV:

\`\`\`bash
npm run kv:clear -- --yes
\`\`\`

After deleting a key, the next AI-agent request falls back to the origin page and schedules a background warmup. A later AI-agent request receives the regenerated Markdown.
`;
}
