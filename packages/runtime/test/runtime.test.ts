import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryResourceStore,
  handleAgentRailRequest,
  type StoredMarkdownResource
} from "../src/index.js";

test("runtime returns Markdown for known AI agents when a ready resource exists", async () => {
  const store = createMemoryResourceStore({
    "page:https://example.com/pricing": {
      status: "ready",
      markdown: "# Pricing\n\nAgent-ready pricing."
    }
  });

  const response = await handleAgentRailRequest(
    new Request("https://example.com/pricing", {
      headers: { "user-agent": "GPTBot/1.0" }
    }),
    {
      store,
      originFetch: async () => new Response("origin html")
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("x-ai-response-layer"), "AgentRail");
  assert.equal(response.headers.get("x-ai-resource-state"), "ready");
  assert.equal(await response.text(), "# Pricing\n\nAgent-ready pricing.");
});

test("runtime passes through misses and warms GET resources through the scheduler", async () => {
  const store = createMemoryResourceStore();
  const scheduled: Array<Promise<unknown>> = [];

  const response = await handleAgentRailRequest(
    new Request("https://example.com/pricing", {
      headers: { "user-agent": "GPTBot/1.0" }
    }),
    {
      store,
      schedule(task) {
        scheduled.push(task);
      },
      originFetch: async () =>
        new Response("<html><head><title>Pricing</title></head><body><main><h1>Pricing</h1></main></body></html>", {
          headers: { "content-type": "text/html" }
        })
    }
  );

  assert.equal(await response.text(), "<html><head><title>Pricing</title></head><body><main><h1>Pricing</h1></main></body></html>");
  assert.equal(scheduled.length, 1);

  await Promise.all(scheduled);

  const stored = await store.get("page:https://example.com/pricing", { type: "json" }) as StoredMarkdownResource | null;
  assert.equal(stored?.status, "ready");
  assert.match(stored?.markdown ?? "", /# Pricing/);
});
