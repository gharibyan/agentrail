import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryResourceStore } from "../../runtime/src/index.js";
import { createAgentRailMiddleware, createFileResourceStore, createNestAgentRailMiddleware } from "../src/index.js";

test("node middleware sends Markdown for known AI agents with ready resources", async () => {
  const store = createMemoryResourceStore({
    "page:https://example.com/pricing": {
      status: "ready",
      markdown: "# Pricing\n\nAgent-ready pricing."
    }
  });
  const response = createNodeResponse();
  let nextCalled = false;

  await createAgentRailMiddleware({ origin: "https://example.com", store })(
    createNodeRequest({
      url: "/pricing",
      headers: { "user-agent": "GPTBot/1.0" }
    }),
    response,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("x-ai-response-layer"), "AgentRail");
  assert.equal(response.body, "# Pricing\n\nAgent-ready pricing.");
});

test("node middleware passes human traffic through to the application", async () => {
  const response = createNodeResponse();
  let nextCalled = false;

  await createAgentRailMiddleware({
    origin: "https://example.com",
    store: createMemoryResourceStore()
  })(
    createNodeRequest({
      url: "/pricing",
      headers: { "user-agent": "Mozilla/5.0" }
    }),
    response,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
  assert.equal(response.ended, false);
});

test("node middleware warms missing resources in the background before passing through", async () => {
  const store = createMemoryResourceStore();
  const scheduled: Array<Promise<unknown>> = [];
  let nextCalled = false;

  await createNestAgentRailMiddleware({
    origin: "https://example.com",
    store,
    schedule(task) {
      scheduled.push(task);
    },
    fetcher: async () =>
      new Response("<html><head><title>Pricing</title></head><body><main><h1>Pricing</h1></main></body></html>", {
        headers: { "content-type": "text/html" }
      })
  })(
    createNodeRequest({
      url: "/pricing",
      headers: { "user-agent": "GPTBot/1.0" }
    }),
    createNodeResponse(),
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
  assert.equal(scheduled.length, 1);

  await Promise.all(scheduled);

  const stored = await store.get("page:https://example.com/pricing", { type: "json" });
  assert.ok(stored && typeof stored === "object");
  assert.equal(stored?.status, "ready");
  assert.match(stored?.markdown ?? "", /# Pricing/);
});

test("file resource store persists Markdown records for self-hosted trials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentrail-node-"));
  const store = createFileResourceStore({ directory });

  await store.put("page:https://example.com/pricing", JSON.stringify({
    status: "ready",
    markdown: "# Pricing"
  }));

  const secondStore = createFileResourceStore({ directory });
  const stored = await secondStore.get("page:https://example.com/pricing", { type: "json" });

  assert.ok(stored && typeof stored === "object");
  assert.equal(stored?.status, "ready");
  assert.equal(stored?.markdown, "# Pricing");
});

function createNodeRequest({
  method = "GET",
  url,
  headers
}: {
  method?: string;
  url: string;
  headers: Record<string, string>;
}) {
  return {
    method,
    url,
    headers
  };
}

function createNodeResponse() {
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    headers,
    ended: false,
    body: "",
    setHeader(name: string, value: number | string | string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
    },
    end(value = "") {
      this.ended = true;
      this.body = String(value);
    }
  };
}
