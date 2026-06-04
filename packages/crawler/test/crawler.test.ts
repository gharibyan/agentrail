import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type CrawlRecord,
  crawlPage,
  discoverPageLinks,
  parseSitemapUrls,
  resourceKeyForUrl
} from "../src/index.js";

type StoreWrite = [string, CrawlRecord];

test("parses sitemap loc values", () => {
  const urls = parseSitemapUrls(`
    <urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/pricing</loc></url>
    </urlset>
  `);

  assert.deepEqual(urls, ["https://example.com/", "https://example.com/pricing"]);
});

test("discovers same-origin page links and skips assets", () => {
  const links = discoverPageLinks({
    html: `
      <main>
        <a href="/pricing">Pricing</a>
        <a href="https://example.com/docs?utm=1">Docs</a>
        <a href="https://other.com/page">External</a>
        <a href="/logo.png">Logo</a>
      </main>
    `,
    baseUrl: "https://example.com/"
  });

  assert.deepEqual(links, ["https://example.com/pricing", "https://example.com/docs"]);
});

test("builds stable resource keys without query strings", () => {
  assert.equal(
    resourceKeyForUrl("https://example.com/pricing?utm=1#top"),
    "page:https://example.com/pricing"
  );
});

test("stores ready Markdown for successful HTML pages", async () => {
  const writes: StoreWrite[] = [];
  const result = await crawlPage({
    url: "https://example.com/pricing",
    generatedAt: "2026-06-03T00:00:00.000Z",
    fetcher: async () =>
      new Response("<html><head><title>Pricing</title></head><body><main><h1>Pricing</h1></main></body></html>", {
        headers: { "content-type": "text/html" }
      }),
    store: {
      put: async (key: string, value: string) => {
        writes.push([key, JSON.parse(value) as CrawlRecord]);
      }
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(writes[0][0], "page:https://example.com/pricing");
  assert.equal(writes[0][1].status, "ready");
  assert.match(writes[0][1].markdown, /^# Pricing/);
});

test("records failed crawl state for non-html responses", async () => {
  const writes: StoreWrite[] = [];
  const result = await crawlPage({
    url: "https://example.com/file.pdf",
    generatedAt: "2026-06-03T00:00:00.000Z",
    fetcher: async () => new Response("PDF", { headers: { "content-type": "application/pdf" } }),
    store: {
      put: async (key: string, value: string) => {
        writes.push([key, JSON.parse(value) as CrawlRecord]);
      }
    }
  });

  assert.equal(result.status, "failed");
  if (result.status !== "failed") {
    throw new Error("expected failed crawl result");
  }
  assert.equal(writes[0][0], "page:https://example.com/file.pdf");
  if (writes[0][1].status !== "failed") {
    throw new Error("expected failed stored crawl record");
  }
  assert.equal(writes[0][1].reason, "unsupported-content-type");
});
