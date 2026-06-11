import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRequest } from "../src/index.js";

test("classifies GPTBot as an AI agent", () => {
  assert.deepEqual(classifyRequest({ userAgent: "GPTBot/1.0" }), {
    type: "ai-agent",
    name: "GPTBot"
  });
});

test("classifies Googlebot as a search crawler", () => {
  assert.deepEqual(classifyRequest({ userAgent: "Mozilla/5.0 Googlebot/2.1" }), {
    type: "search-crawler",
    name: "Googlebot"
  });
});

test("classifies default AI bot allowlist as AI agents", () => {
  const aiBotUserAgents = [
    ["Applebot/0.1", "Applebot"],
    ["ChatGPT-User/1.0", "ChatGPT-User"],
    ["GPTBot/1.0", "GPTBot"],
    ["OAI-SearchBot/1.0", "OAI-SearchBot"],
    ["Google-CloudVertexBot/1.0", "Google-CloudVertexBot"],
    ["PerplexityBot/1.0", "PerplexityBot"],
    ["ClaudeBot/1.0", "ClaudeBot"],
    ["Mozilla/5.0 (compatible; Claude/1.0)", "Claude"],
    ["CCBot/2.0", "CCBot"],
    ["Claude-SearchBot/1.0", "Claude-SearchBot"],
    ["Amazonbot/1.0", "Amazonbot"],
    ["Anchor Browser/1.0", "Anchor Browser"],
    ["Bytespider/1.0", "Bytespider"],
    ["Claude-User/1.0", "Claude-User"],
    ["Cloudflare Crawler/1.0", "Cloudflare Crawler"],
    ["DuckAssistBot/1.0", "DuckAssistBot"],
    ["FacebookBot/1.0", "FacebookBot"],
    ["Manus Bot/1.0", "Manus Bot"],
    ["Meta-ExternalAgent/1.0", "Meta-ExternalAgent"],
    ["Meta-ExternalFetcher/1.0", "Meta-ExternalFetcher"],
    ["MistralAI-User/1.0", "MistralAI-User"],
    ["Novellum AI Crawl/1.0", "Novellum AI Crawl"],
    ["Perplexity-User/1.0", "Perplexity-User"],
    ["PetalBot/1.0", "PetalBot"],
    ["ProRataInc/1.0", "ProRataInc"],
    ["TikTok Spider/1.0", "TikTok Spider"],
    ["Timpibot/1.0", "Timpibot"]
  ] as const;

  for (const [userAgent, name] of aiBotUserAgents) {
    assert.deepEqual(classifyRequest({ userAgent }), {
      type: "ai-agent",
      name
    });
  }
});

test("keeps known non-AI crawlers out of the AI agent path", () => {
  const searchCrawlerUserAgents = [
    ["Mozilla/5.0 Googlebot/2.1", "Googlebot"],
    ["BingBot/2.0", "Bingbot"],
    ["archive.org_bot/1.0", "archive.org_bot"],
    ["Arquivo Web Crawler/1.0", "Arquivo Web Crawler"],
    ["Terracotta Bot/1.0", "Terracotta Bot"]
  ] as const;

  for (const [userAgent, name] of searchCrawlerUserAgents) {
    assert.deepEqual(classifyRequest({ userAgent }), {
      type: "search-crawler",
      name
    });
  }
});

test("classifies a normal browser as browser traffic", () => {
  const result = classifyRequest({
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
    headers: { accept: "text/html" }
  });

  assert.equal(result.type, "browser");
  assert.equal(result.name, "Browser");
});

test("classifies generic bot traffic as unknown by default", () => {
  assert.deepEqual(classifyRequest({ userAgent: "ExampleBot/1.0" }), {
    type: "unknown-bot",
    name: "ExampleBot"
  });
});

test("allows custom AI bot patterns", () => {
  assert.deepEqual(
    classifyRequest({
      userAgent: "InternalAgent/2026",
      aiBotPatterns: [{ name: "InternalAgent", pattern: /internalagent/i }]
    }),
    {
      type: "ai-agent",
      name: "InternalAgent"
    }
  );
});
