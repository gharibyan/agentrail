import { test } from "node:test";
import assert from "node:assert/strict";
import { type AgentRailEnv, type StoredMarkdownResource, handleRequest, handleScheduled } from "../src/index.js";

function createEnv(resource: StoredMarkdownResource | null): AgentRailEnv {
  return {
    AGENTRAIL_RESOURCES: {
      async get() {
        return resource ?? null;
      },
      async put() {
        throw new Error("put is not used in this test env");
      }
    }
  };
}

test("returns Markdown to known AI bots when a ready resource exists", async () => {
  const response = await handleRequest(
    new Request("https://example.com/pricing", {
      headers: { "user-agent": "GPTBot/1.0" }
    }),
    createEnv({
      status: "ready",
      markdown: "# Pricing\n\nAgent-ready pricing."
    }),
    {},
    async () => new Response("origin")
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("x-ai-response-layer"), "AgentRail");
  assert.equal(response.headers.get("x-ai-resource-state"), "ready");
  assert.equal(await response.text(), "# Pricing\n\nAgent-ready pricing.");
});

test("passes through AI bot requests when no Markdown resource exists", async () => {
  const response = await handleRequest(
    new Request("https://example.com/pricing", {
      headers: { "user-agent": "GPTBot/1.0" }
    }),
    createEnv(null),
    {},
    async () => new Response("origin html", { headers: { "content-type": "text/html" } })
  );

  assert.equal(response.headers.get("content-type"), "text/html");
  assert.equal(await response.text(), "origin html");
});

test("warms missing AI bot resources in the background from the origin response", async () => {
  const writes: Array<[string, StoredMarkdownResource]> = [];
  const waitUntilTasks: Array<Promise<unknown>> = [];
  const env: AgentRailEnv = {
    AGENTRAIL_RESOURCES: {
      async get() {
        return null;
      },
      async put(key: string, value: string) {
        writes.push([key, JSON.parse(value) as StoredMarkdownResource]);
      }
    }
  };

  const response = await handleRequest(
    new Request("https://example.com/pricing", {
      headers: { "user-agent": "GPTBot/1.0" }
    }),
    env,
    {
      waitUntil(task: Promise<unknown>) {
        waitUntilTasks.push(task);
      }
    },
    async () =>
      new Response("<html><head><title>Pricing</title></head><body><main><h1>Pricing</h1></main></body></html>", {
        headers: { "content-type": "text/html" }
      })
  );

  assert.equal(response.headers.get("content-type"), "text/html");
  assert.match(await response.text(), /<h1>Pricing<\/h1>/);
  assert.equal(waitUntilTasks.length, 1);

  await Promise.all(waitUntilTasks);

  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "page:https://example.com/pricing");
  assert.equal(writes[0][1].status, "ready");
  assert.match(writes[0][1].markdown ?? "", /# Pricing/);
});

test("passes browser traffic through to origin", async () => {
  const response = await handleRequest(
    new Request("https://example.com/pricing", {
      headers: { "user-agent": "Mozilla/5.0 Chrome/125 Safari/537.36" }
    }),
    createEnv({
      status: "ready",
      markdown: "# Pricing"
    }),
    {},
    async () => new Response("browser html")
  );

  assert.equal(await response.text(), "browser html");
});

test("passes asset requests through even for AI bots", async () => {
  const response = await handleRequest(
    new Request("https://example.com/logo.png", {
      headers: { "user-agent": "GPTBot/1.0" }
    }),
    createEnv({
      status: "ready",
      markdown: "# Logo"
    }),
    {},
    async () => new Response("png")
  );

  assert.equal(await response.text(), "png");
});

test("scheduled crawling can process sitemap pages directly in basic KV mode", async () => {
  const writes: Array<[string, StoredMarkdownResource]> = [];
  const env: AgentRailEnv = {
    AGENTRAIL_SITEMAP_URL: "https://example.com/sitemap.xml",
    AGENTRAIL_MAX_PAGES_PER_RUN: "2",
    AGENTRAIL_RESOURCES: {
      async get() {
        return null;
      },
      async put(key: string, value: string) {
        writes.push([key, JSON.parse(value) as StoredMarkdownResource]);
      }
    }
  };

  await handleScheduled(
    {},
    env,
    {},
    async (url) => {
      if (url === "https://example.com/sitemap.xml") {
        return new Response("<urlset><url><loc>https://example.com/pricing</loc></url></urlset>");
      }
      return new Response("<html><head><title>Pricing</title></head><body><main><h1>Pricing</h1></main></body></html>", {
        headers: { "content-type": "text/html" }
      });
    }
  );

  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "page:https://example.com/pricing");
  assert.equal(writes[0][1].status, "ready");
});
