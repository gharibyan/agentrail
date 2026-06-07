import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectFiles, normalizeProjectName } from "../src/scaffold.js";

test("normalizes project names for npm packages and directories", () => {
  assert.equal(normalizeProjectName("My AI Site!"), "my-ai-site");
  assert.equal(normalizeProjectName("  "), "agentrail-site");
});

test("builds a Wrangler-compatible Cloudflare project scaffold", () => {
  const files = buildProjectFiles({
    projectName: "demo-site",
    origin: "https://example.com",
    route: "example.com/*",
    crawlSchedule: "0 */6 * * *",
    storageMode: "basic",
    kvNamespaceId: "abc123"
  });

  assert.ok(files["package.json"]);
  assert.ok(files["wrangler.jsonc"]);
  assert.ok(files["src/index.ts"]);
  assert.ok(files["scripts/agentrail-kv.mjs"]);
  assert.ok(files["tsconfig.json"]);
  assert.match(files["package.json"], /"name": "demo-site"/);
  assert.match(files["package.json"], /"dev": "wrangler dev --test-scheduled"/);
  assert.match(files["package.json"], /"kv:drop": "node scripts\/agentrail-kv\.mjs drop"/);
  assert.match(files["package.json"], /"kv:clear": "node scripts\/agentrail-kv\.mjs clear"/);
  assert.match(files["package.json"], /"wrangler": "\^4\.97\.0"/);
  assert.match(files["package.json"], /"node": ">=22"/);
  assert.match(files["wrangler.jsonc"], /"pattern": "example.com\/\*"/);
  assert.match(files["wrangler.jsonc"], /"id": "abc123"/);
  assert.match(files["wrangler.jsonc"], /"crons": \[/);
  const wranglerConfig = JSON.parse(files["wrangler.jsonc"]);
  assert.equal(wranglerConfig.observability.enabled, false);
  assert.equal(wranglerConfig.observability.logs.enabled, true);
  assert.equal(wranglerConfig.observability.logs.persist, true);
  assert.equal(wranglerConfig.observability.logs.invocation_logs, true);
  assert.equal(wranglerConfig.observability.traces.enabled, false);
  assert.match(files["src/index.ts"], /AGENTRAIL_ORIGIN/);
  assert.match(files["src/index.ts"], /AgentRailEnv/);
  assert.match(files["src/index.ts"], /agentrail\.queue\(batch, env\);/);
  assert.match(files["README.md"], /KV namespace configured automatically/);
  assert.match(files["README.md"], /installs dependencies automatically by default/);
  assert.match(files["README.md"], /workers\.dev subdomain/);
  assert.match(files["README.md"], /__scheduled/);
  assert.match(files["README.md"], /persist Worker logs/);
  assert.match(files["README.md"], /npm run kv:drop -- https:\/\/example\.com\/features/);
  assert.match(files["README.md"], /npm run kv:clear -- --yes/);
  assert.match(files["scripts/agentrail-kv.mjs"], /resourceKeyForUrl/);
  assert.match(files["scripts/agentrail-kv.mjs"], /const \[, , command, \.\.\.args\] = process\.argv/);
  assert.match(files["scripts/agentrail-kv.mjs"], /wrangler", \["kv", "key", "delete"/);
  assert.match(files["scripts/agentrail-kv.mjs"], /wrangler", \["kv", "bulk", "delete"/);
});

test("can scaffold with local file dependencies before packages are published", () => {
  const files = buildProjectFiles({
    projectName: "demo-site",
    localPackageRoot: "/Users/example/agentrail",
    targetDir: "/Users/example/agentrail/projects/demo-site"
  });

  const manifest = JSON.parse(files["package.json"]);

  assert.equal(manifest.dependencies["@agentrail/worker"], "file:../../packages/worker");
  assert.equal(manifest.dependencies["@agentrail/runtime"], "file:../../packages/runtime");
  assert.equal(manifest.dependencies["@agentrail/bot-detector"], "file:../../packages/bot-detector");
  assert.equal(manifest.dependencies["@agentrail/crawler"], "file:../../packages/crawler");
  assert.equal(manifest.dependencies["@agentrail/markdown-extractor"], "file:../../packages/markdown-extractor");
});

test("keeps a manual KV placeholder when no namespace id is provided", () => {
  const files = buildProjectFiles({
    projectName: "demo-site"
  });

  assert.match(files["wrangler.jsonc"], /replace-with-agentrail-resources-kv-id/);
  assert.match(files["README.md"], /npx wrangler kv namespace create AGENTRAIL_RESOURCES/);
});
