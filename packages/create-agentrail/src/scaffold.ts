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
`;
}
